import { remote } from 'electron'

const {$, config, toggleModal, log, error, i18n, dbg} = window
const __ = i18n.others.__.bind(i18n.others)
const __n = i18n.others.__n.bind(i18n.others)

import './services/update'
import './services/layout'
import './services/welcome'
import './services/doyouknow'
import './services/modernization-delta'
import './services/developmentProphecy'
import './services/sortieDangerousCheck'
import './services/sortieFreeSlotCheck'

const refreshFlash = () =>
  $('kan-game webview').executeJavaScript(`
    var doc;
    if (document.getElementById('game_frame')) {
      doc = document.getElementById('game_frame').contentDocument;
    } else {
      doc = document;
    }
    var flash = doc.getElementById('flashWrap');
    if(flash) {
      var flashInnerHTML = flash.innerHTML;
      flash.innerHTML = '';
      flash.innerHTML = flashInnerHTML;
    }
  `)

// F5 & Ctrl+F5 & Alt+F5
window.addEventListener('keydown', (e) => {
  if (process.platform == 'darwin') {
    if (e.keyCode === 91 || e.keyCode === 93) {
      // When the game (flash) is on focus, it catches all keypress events
      // Blur the webview when any Cmd key is pressed,
      // so the OS shortcuts will always work
      remote.getCurrentWindow().blurWebView()
    } else if (e.keyCode === 82 && e.metaKey) {
      if (e.shiftKey) { // cmd + shift + r
        $('kan-game webview').reloadIgnoringCache()
      } else if (e.altKey) { // cmd + alt + r
        refreshFlash()
      } else { // cmd + r
        // Catched by menu
        // $('kan-game webview').reload()
        return false
      }
    }
  } else if (e.keyCode === 116){
    if (e.ctrlKey) { // ctrl + f5
      $('kan-game webview').reloadIgnoringCache()
    } else if (e.altKey){ // alt + f5
      refreshFlash()
    } else if (!e.metaKey){ // f5
      $('kan-game webview').reload()
    }
  }
})

// Confirm before quit
let confirmExit = false
const exitPoi = () => {
  confirmExit = true
  remote.require('./lib/window').rememberMain()
  remote.require('./lib/window').closeWindows()
  window.onbeforeunload = null
  window.close()
}
window.onbeforeunload = (e) => {
  if (confirmExit || !config.get('poi.confirm.quit', false)) {
    exitPoi()
  } else {
    toggleModal(__('Exit'), __('Confirm?'), [{
      name: __('Confirm'),
      func: exitPoi,
      style: 'warning',
    }])
    e.returnValue = false
  }
}
class GameResponse {
  constructor(path, body, postBody) {
    this.path = path
    this.body = body
    this.postBody = postBody
    Object.defineProperty(this, 'ClickToCopy -->', {get: () => {
      require('electron').clipboard.writeText(JSON.stringify({path, body, postBody}))
      return `Copied: ${this.path}`
    }})
  }
}

window.addEventListener('game.request', (e) => {
  //const {method} = e.detail
  //const resPath = e.detail.path
})
window.addEventListener ('game.response', (e) => {
  const {method, body, postBody} = e.detail
  const resPath = e.detail.path
  if (dbg.extra('gameResponse').isEnabled()) {
    dbg._getLogFunc()(new GameResponse(resPath, body, postBody))
  }
  if (config.get('poi.showNetworkLog', true)) {
    log(`${__('Hit')} ${method} ${resPath}`, {dontReserve: true})
  }
})
window.addEventListener ('network.error', () => {
  error(__('Connection failed.'), {dontReserve: true})
})
window.addEventListener('network.error.retry', (e) => {
  const {counter} = e.detail
  error(__n('Connection failed after %s retry',  counter), {dontReserve: true})
})
window.addEventListener('network.invalid.result', (e) => {
  const {code} = e.detail
  error(__('The server presented you a cat. (Error code: %s)',  code), {dontReserve: true})
})
