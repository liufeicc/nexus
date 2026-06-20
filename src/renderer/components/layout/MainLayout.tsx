/**
 * 布局组件
 */

import React from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import TerminalArea from '../terminal/TerminalArea'
import StatusBar from './StatusBar'

/**
 * 主布局组件
 */
export function MainLayout() {
  return (
    <div className="app">
      <Header />
      <div className="app-main">
        <Sidebar />
        <main className="main-content">
          <Toolbar />
          <TerminalArea />
          <StatusBar />
        </main>
      </div>
    </div>
  )
}

export default MainLayout
