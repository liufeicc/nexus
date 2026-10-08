import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import 'xterm/css/xterm.css'
import { initOverlayBridge } from './overlay/bridge-main'

// 共享置顶弹层桥接（主窗口侧）：切片推送/action 执行器/事件中继
initOverlayBridge()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// macOS: 给 body 添加平台 class，供 CSS 为原生 traffic lights 预留空间
if (window.electronAPI?.platform?.isMac) {
  document.body.classList.add('platform-mac')
}
