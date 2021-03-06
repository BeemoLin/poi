import { get, set } from 'lodash'
import { remote } from 'electron'
import { join, basename } from 'path-extra'
import fs from 'fs-extra'
import React from 'react'
import FontAwesome from 'react-fontawesome'
import semver from 'semver'

const {ROOT, config, language, notify, MODULE_PATH} = window
const windowManager = remote.require('./lib/window')
const utils = remote.require('./lib/utils')
const __ = window.i18n.setting.__.bind(window.i18n.setting)

require('module').globalPaths.push(MODULE_PATH)

const getPluginIndexByPackageName = (plugins, packageName) => {
  for (let i = 0; i < plugins.length; i++) {
    if (plugins[i].packageName === packageName) {
      return i
    }
  }
  return -1
}

const updateI18n = (plugin) => {
  let i18nFile = null
  if (plugin.i18nDir != null) {
    i18nFile = join(plugin.pluginPath, plugin.i18nDir)
  } else {
    try {
      fs.accessSync(join(plugin.pluginPath, 'i18n'))
      i18nFile = join(plugin.pluginPath, 'i18n')
    } catch (error) {
      try {
        fs.accessSync(join(plugin.pluginPath, 'assets', 'i18n'))
        i18nFile = join(plugin.pluginPath, 'assets', 'i18n')
      } catch (error) {
        console.warn(`${plugin.packageName}: No translate file found.`)
      }
    }
  }
  if (i18nFile != null) {
    const namespace = plugin.id
    window.i18n[namespace] = new (require('i18n-2'))({
      locales: ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-TW'],
      defaultLocale: 'zh-CN',
      directory: i18nFile,
      updateFiles: false,
      indent: "\t",
      extension: '.json',
      devMode: false,
    })
    window.i18n[namespace].setLocale(window.language)
    plugin.name = window.i18n[namespace].__(plugin.name)
    plugin.description = window.i18n[namespace].__(plugin.description)
  }
  return plugin
}

const readPlugin = (pluginPath) => {
  let pluginData, packageData, plugin, pluginMain
  try {
    pluginData = fs.readJsonSync(join(ROOT, 'assets', 'data', 'plugin.json'))
  } catch (error) {
    pluginData = {}
    utils.error(error)
  }
  try {
    packageData = fs.readJsonSync(join(pluginPath, 'package.json'))
  } catch (error) {
    packageData = {}
    utils.error(error)
  }
  plugin = packageData.poiPlugin || {}
  plugin.packageData = packageData
  plugin.packageName = plugin.packageData.name || basename(pluginPath)
  if (plugin.name == null) {
    plugin.name = plugin.title || plugin.packageName
  }
  if (plugin.id == null) {
    plugin.id = plugin.packageName
  }
  plugin.author = get(plugin, 'packageData.author.name') || 'unknown'
  if (typeof get(plugin, 'packageData.author') === 'string') {
    plugin.author = plugin.packageData.author
  }
  plugin.link = get(plugin, 'packageData.author.links') || get(plugin, 'packageData.author.url') || (pluginData[plugin.packageName] || {}).link || "https://github.com/poooi"
  if (plugin.description == null) {
    plugin.description = (plugin.packageData || {}).description || (pluginData[plugin.packageName] || {})[`des${language}`] || "unknown"
  }
  plugin.pluginPath = pluginPath
  if (plugin.icon == null) {
    plugin.icon = 'fa/th-large'
  }
  plugin.version = (plugin.packageData || {}).version || '0.0.0'
  plugin.lastestVersion = plugin.version
  if (!plugin.earliestCompatibleMain) {
    plugin.earliestCompatibleMain = '0.0.0'
  }
  if (!plugin.lastApiVer) {
    plugin.lastApiVer = plugin.version
  }
  if (!plugin.priority) {
    plugin.priority = 10000
  }
  plugin.enabled = config.get(`plugin.${plugin.id}.enable`, true)
  plugin.isInstalled = true
  plugin.needRollback = false
  if (plugin.apiVer) {
    let nearestCompVer = 'v214.748.3647'
    for (const mainVersion in plugin.apiVer) {
      if (semver.lte(window.POI_VERSION, mainVersion) && semver.lt(mainVersion, nearestCompVer) && semver.gt(plugin.version, plugin.apiVer[mainVersion])) {
        plugin.needRollback = true
        nearestCompVer = mainVersion
        plugin.lastestVersion = plugin.apiVer[mainVersion]
      }
    }
  }
  plugin.isOutdated = plugin.needRollback
  plugin = updateI18n(plugin)
  let icon = plugin.icon.split('/')[1] || plugin.icon || 'th-large'
  plugin.displayName = (
    <span>
      <FontAwesome key={0} name={icon} />
      {' ' + plugin.name}
    </span>
  )
  if (plugin.enabled && !plugin.needRollback) {
    try {
      pluginMain = require(pluginPath)
      pluginMain.isRead = true
      if (!get(plugin, 'packageData.poiPlugin.id') && pluginMain.name) {
        plugin.id = pluginMain.name
      }
      if (pluginMain.displayName) {
        plugin.displayName = pluginMain.displayName
      }
      if (plugin.priority === 10000 && (pluginMain.priority != null)) {
        plugin.priority = pluginMain.priority
      }
    } catch (error) {
      console.error(`[Plugin ${plugin.name}] `, error.stack)
      pluginMain = {
        isBroken: true,
      }
    }
    Object.assign(pluginMain, plugin)
    plugin = pluginMain
    pluginMain = null
    if (plugin.isRead == null) {
      plugin.isRead = false
    }
  }
  return plugin
}

const enablePlugin = (plugin) => {
  if (!plugin.isRead && !plugin.isBroken) {
    let pluginMain
    try {
      pluginMain = require(plugin.pluginPath)
      pluginMain.isRead = true
      if (!plugin.packageData.poiPlugin.id && pluginMain.name) {
        plugin.id = pluginMain.name
      }
      if (pluginMain.displayName) {
        plugin.displayName = pluginMain.displayName
      }
      if (plugin.priority === 10000 && (pluginMain.priority != null)) {
        plugin.priority = pluginMain.priority
      }
    } catch (error) {
      console.error(error)
      pluginMain = {
        isBroken: true,
      }
    }
    Object.assign(pluginMain, plugin)
    if (pluginMain.isRead == null) {
      pluginMain.isRead = false
    }
    plugin = pluginMain
  }
  plugin = loadPlugin(plugin)
  plugin.enabled = true
  config.set(`plugin.${plugin.id}.enable`, true)
  return plugin
}

const disablePlugin = (plugin) => {
  config.set(`plugin.${plugin.id}.enable`, false)
  plugin.enabled = false
  plugin = unloadPlugin(plugin)
  return plugin
}

const loadPlugin = (plugin) => {
  let windowOptions
  if (plugin.windowURL) {
    if (plugin.windowOptions) {
      windowOptions = plugin.windowOptions
      if (!get(windowOptions, 'webPreferences.preload')) {
        set(windowOptions, 'webPreferences.preload', join(ROOT, 'assets', 'js', 'plugin-preload.js'))
      }
    } else {
      windowOptions = {
        x: config.get('poi.window.x', 0),
        y: config.get('poi.window.y', 0),
        width: 800,
        height: 600,
        webPreferences: {
          preload: join(ROOT, 'assets', 'js', 'plugin-preload.js'),
        },
      }
    }
    Object.assign(windowOptions, {
      realClose: plugin.realClose,
    })
    if (plugin.multiWindow) {
      plugin.handleClick = function() {
        const pluginWindow = windowManager.createWindow(windowOptions)
        pluginWindow.loadURL(plugin.windowURL)
        pluginWindow.show()
      }
    } else if (plugin.realClose) {
      plugin.pluginWindow = null
      plugin.handleClick = function() {
        if (plugin.pluginWindow == null) {
          plugin.pluginWindow = windowManager.createWindow(windowOptions)
          plugin.pluginWindow.on('close', function() {
            plugin.pluginWindow = null
          })
          plugin.pluginWindow.loadURL(plugin.windowURL)
          plugin.pluginWindow.show()
        } else {
          plugin.pluginWindow.show()
        }
      }
    } else {
      plugin.pluginWindow = windowManager.createWindow(windowOptions)
      plugin.pluginWindow.loadURL(plugin.windowURL)
      plugin.handleClick = function() {
        return plugin.pluginWindow.show()
      }
    }
  }
  try {
    if (typeof plugin.pluginDidLoad === 'function') {
      plugin.pluginDidLoad()
    }
  } catch (error) {
    console.error(error.stack)
  }
  return plugin
}

const unloadPlugin = (plugin) => {
  try {
    if (typeof plugin.pluginWillUnload === 'function') {
      plugin.pluginWillUnload()
    }
  } catch (error) {
    console.error(error.stack)
  }
  if (plugin.pluginWindow) {
    windowManager.closeWindow(plugin.pluginWindow)
  }
  return plugin
}

const notifyFailed = (state) => {
  const plugins = state.filter((plugin) => (plugin.isBroken))
  const unreadList = []
  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i]
    unreadList.push(plugin.name)
  }
  if (unreadList.length > 0) {
    const content = `${unreadList.join(' ')} ${__('failed to load. Maybe there are some compatibility problems.')}`
    notify(content, {
      type: 'plugin error',
      title: __('Plugin error'),
      icon: join(ROOT, 'assets', 'img', 'material', '7_big.png'),
      audio: `file://${ROOT}/assets/audio/fail.mp3`,
    })
  }
}

export {
  getPluginIndexByPackageName,
  readPlugin,
  enablePlugin,
  disablePlugin,
  loadPlugin,
  unloadPlugin,
  notifyFailed,
  updateI18n,
}
