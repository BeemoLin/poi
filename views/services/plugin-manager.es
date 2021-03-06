import path from 'path-extra'
import semver from 'semver'
import EventEmitter from 'events'
import fs from 'fs-extra'
import request from 'request'
import npm from 'npm'
import { promisify, promisifyAll } from 'bluebird'

const __ = window.i18n.setting.__.bind(window.i18n.setting)
const {config, notify, proxy, ROOT, PLUGIN_PATH, dispatch, getStore} = window
const requestAsync = promisify(promisifyAll(request), {multiArgs: true})

class PluginManager extends EventEmitter {
  constructor(packagePath, pluginPath, mirrorPath) {
    super(packagePath, pluginPath, mirrorPath)
    this.packagePath = packagePath
    this.pluginPath = pluginPath
    this.mirrorPath = mirrorPath
    this.requirements = null
    this.mirrors = null
    this.config = {
      production: true,
      mirror: null,
      proxy: null,
      betaCheck: null,
    }
    this.npmConfig = {
      prefix: this.pluginPath,
      registry: "https://registry.npmjs.org",
      progress: false,
    }
    this.VALID = 0
    this.DISABLED = 1
    this.NEEDUPDATE = 2
    this.BROKEN = 3
  }
  initaialize() {
    this.getConf()
    this.getPlugins()
  }
  readPackage() {
    return this.requirements = fs.readJsonSync(this.packagePath)
  }
  readPlugins() {
    dispatch({
      type: `@@Plugin/initaialize`,
      value: this.pluginPath,
    })
  }
  getRequirements() {
    if (this.requirements != null)
      return this.requirements
    else {
      return this.readPackage()
    }
  }
  getMirrors() {
    if (this.mirrors != null) {
      return this.mirrors
    } else {
      return this.readMirrors()
    }
  }
  readMirrors() {
    this.mirrors = fs.readJsonSync(this.mirrorPath)
    const mirrorConf = config.get('packageManager.mirrorName', (navigator.language === 'zh-CN') ?  "taobao" : "npm")
    const proxyConf = config.get("packageManager.proxy", false)
    const betaCheck = config.get("packageManager.enableBetaPluginCheck", false)
    this.selectConfig(mirrorConf, proxyConf, betaCheck)
    return this.mirrors
  }
  selectConfig(name, enable, check) {
    this.getMirrors()
    if (name) {
      this.config.mirror = this.mirrors[name]
      config.set("packageManager.mirrorName", name)
    }
    if (enable != null) {
      this.config.proxy = enable
      config.set("packageManager.proxy", enable)
    }
    if (check != null) {
      this.config.betaCheck = check
      config.set("packageManager.enableBetaPluginCheck", check)
    }
    this.npmConfig.registry = this.config.mirror.server
    if (this.config.proxy) {
      const {port} = proxy
      this.npmConfig.http_proxy = `http://127.0.0.1:${port}`
    } else {
      if (this.npmConfig.http_proxy) {
        delete this.npmConfig.http_proxy
      }
    }
    npm.load(this.npmConfig)
    return this.config
  }
  isMetRequirement(plugin) {
    let lowest
    if (!plugin.isRead) {
      return false
    }
    if ((this.requirements[plugin.packageName] || {}).version) {
      lowest = this.requirements[plugin.packageName].version
    } else {
      lowest = 'v0.0.0'
    }
    return semver.gte(plugin.packageData.version, lowest)
  }
  isEnabled(plugin) {
    if (!plugin.isRead) {
      return false
    }
    return plugin.enabled
  }
  isValid(plugin) {
    if (!plugin.isRead) {
      return false
    }
    if (!plugin.isInstalled) {
      return false
    }
    if (!this.isEnabled(plugin)) {
      return false
    }
    return this.isMetRequirement(plugin)
  }
  getStatusOfPlugin(plugin) {
    if (plugin.isBroken || plugin.needRollback) {
      return this.BROKEN
    }
    if (!plugin.isRead) {
      return this.DISABLED
    }
    if (!this.isMetRequirement(plugin)) {
      return this.NEEDUPDATE
    }
    if (!this.isEnabled(plugin)) {
      return this.DISABLED
    }
    return this.VALID
  }
  getPlugins() {
    if (getStore('plugins').length > 0) {
      return getStore('plugins')
    }
    else {
      return this.readPlugins()
    }
  }
  getConf() {
    this.getMirrors()
    return this.config
  }
  getInstalledPlugins() {
    return this.getFilteredPlugins((plugin) => (plugin.isInstalled))
  }
  getUninstalledPluginSettings() {
    this.getRequirements()
    const installedPlugins = this.getInstalledPlugins()
    const installedPluginNames = installedPlugins.map((plugin) => (plugin.packageName))
    const uninstalled = {}
    for (const name in this.requirements) {
      const value = this.requirements[name]
      if (!installedPluginNames.includes(name)) {
        uninstalled[name] = value
      }
    }
    return uninstalled
  }
  getReadPlugins() {
    return this.getFilteredPlugins((plugin) => (plugin.isRead))
  }
  getUnreadPlugins() {
    return this.getFilteredPlugins((plugin) => (!plugin.isRead))
  }
  getBrokenPlugins() {
    return this.getFilteredPlugins((plugin) => (plugin.isBroken))
  }
  getValidPlugins() {
    return this.getFilteredPlugins(this.isValid.bind(this))
  }
  getMetRequirementPlugins() {
    return this.getFilteredPlugins(this.isMetRequirement.bind(this))
  }
  getUpdateStatus () {
    for (const i in getStore('plugins')) {
      if (getStore('plugins')[i].isOutdated) {
        return true
      }
    }
    return false
  }
  async getOutdatedPlugins (isNotif) {
    this.getMirrors()
    const plugins = this.getInstalledPlugins()
    const outdatedPlugins = []
    const outdatedList = []
    const tasks = []
    for (const plugin of plugins) {
      tasks.push(new Promise((resolve, reject) => {
        return (async () => {
          if (!plugin.needRollback) {
            try {
              const data = JSON.parse((await requestAsync(`${this.config.mirror.server}${plugin.packageName}/latest`))[1])
              const distTag = {
                latest: data.version,
              }
              if (this.config.betaCheck) {
                const betaData = JSON.parse((await requestAsync(`${this.config.mirror.server}${plugin.packageName}/beta`))[1])
                Object.assign(distTag, {
                  beta: betaData.version,
                })
              }
              let latest = `${plugin.version}`
              let notCompatible = false
              const apiVer = ((data.poiPlugin || {}).apiVer || plugin.apiVer) || {}
              let nearestCompVer = 'v214.748.3647'
              for (const mainVersion of Object.keys(apiVer)) {
                if (!apiVer[mainVersion]) {
                  continue
                }
                if (semver.lte(window.POI_VERSION, mainVersion) && semver.lt(mainVersion, nearestCompVer)) {
                  notCompatible = true
                  nearestCompVer = mainVersion
                  latest = apiVer[mainVersion]
                }
              }
              if (!notCompatible && this.config.betaCheck && distTag.beta) {
                if (semver.gt(distTag.beta, latest)) {
                  latest = distTag.beta
                }
              }
              if (!notCompatible && semver.gt(distTag.latest, latest)) {
                latest = distTag.latest
              }
              if (semver.gt(latest, plugin.version)) {
                outdatedPlugins.push(plugin)
                dispatch({
                  type: '@@Plugin/changeStatus',
                  value: plugin,
                  option: [
                    {
                      path: 'isOutdated',
                      status: true,
                    },
                    {
                      path: 'lastestVersion',
                      status: latest,
                    },
                  ],
                })
                if (plugin.isRead) {
                  outdatedList.push(plugin.name)
                }
              }
            } catch (e) {
              reject(e)
            }
            resolve()
          }
        })()
      }))
    }
    await Promise.all(tasks)
    if (isNotif && outdatedList.length > 0) {
      const content = `${outdatedList.join(' ')} ${__("have newer version. Please update your plugins.")}`
      notify(content, {
        type: 'others',
        title: __('Plugin update'),
        icon: path.join(ROOT, 'assets', 'img', 'material', '7_big.png'),
        audio: `file://${ROOT}/assets/audio/update.mp3`,
      })
    }
    return outdatedPlugins
  }
  getFilteredPlugins(filter) {
    return getStore('plugins').filter(filter)
  }
  async updatePlugin(plugin) {
    dispatch({
      type: '@@Plugin/changeStatus',
      value: plugin,
      option: [
        {
          path: 'isUpdating',
          status: true,
        },
      ],
    })
    try {
      // let flow = co.wrap(function* (_this) {
      //   yield npminstall({
      //     root: _this.npmConfig.prefix,
      //     pkgs: [
      //       { name: plugin.packageName, version: plugin.lastestVersion},
      //     ],
      //     registry: _this.npmConfig.registry,
      //     debug: true
      //   })
      //   return yield Promise.resolve()
      // })
      // await flow(this)
      await promisify(npm.commands.install)([`${plugin.packageName}@${plugin.lastestVersion}`])
      return this.reloadPlugin(plugin)
    } catch (error) {
      dispatch({
        type: '@@Plugin/changeStatus',
        value: plugin,
        option: [
          {
            path: 'isUpdating',
            status: false,
          },
        ],
      })
      throw error
    }
  }
  async installPlugin(name) {
    this.getMirrors()
    try {
      const list = getStore('plugins').map((plugin) => (plugin.packageName))
      // let flow = co.wrap(function* (_this) {
      //   yield npminstall({
      //     root: _this.npmConfig.prefix,
      //     pkgs: [
      //       { name: name},
      //     ],
      //     registry: _this.npmConfig.registry,
      //     debug: true
      //   })
      //   return yield Promise.resolve()
      // })
      // await flow(this)
      await promisify(npm.commands.install)([name])
      const [packName] = name.split('@')
      if (list.includes(packName)) {
        this.reloadPlugin(packName)
      } else {
        this.addPlugin(path.join(this.pluginPath, 'node_modules', packName))
      }
      return getStore('plugins')
    } catch (error) {
      console.error(error.stack)
      throw error
    }
  }
  async uninstallPlugin(plugin) {
    this.getMirrors()
    try {
      dispatch({
        type: '@@Plugin/changeStatus',
        value: plugin,
        option: [
          {
            path: 'isUninstalling',
            status: true,
          },
        ],
      })
      this.removePlugin(plugin)
      await promisify(npm.commands.uninstall)([plugin.packageName])
    } catch (error) {
      console.error(error)
      throw error
    }
  }
  enablePlugin(plugin) {
    dispatch({
      type: '@@Plugin/enable',
      value: plugin,
    })
  }
  disablePlugin(plugin) {
    dispatch({
      type: '@@Plugin/disable',
      value: plugin,
    })
  }
  loadPlugin(plugin) {
    dispatch({
      type: '@@Plugin/load',
      value: plugin,
    })
  }
  unloadPlugin(plugin) {
    dispatch({
      type: '@@Plugin/unload',
      value: plugin,
    })
  }
  removePlugin(plugin) {
    dispatch({
      type: '@@Plugin/remove',
      value: plugin,
    })
  }
  addPlugin(pluginPath) {
    dispatch({
      type: '@@Plugin/add',
      value: pluginPath,
    })
  }
  reloadPlugin(plugin) {
    dispatch({
      type: '@@Plugin/reload',
      value: plugin,
    })
  }
}

const pluginManager = new PluginManager(
  path.join(ROOT, 'assets', 'data', 'plugin.json'),
  PLUGIN_PATH,
  path.join(ROOT, 'assets', 'data', 'mirror.json')
)

pluginManager.initaialize()

export default pluginManager
