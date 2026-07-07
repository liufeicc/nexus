/**
 * 引导窗口 React 入口
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { OnboardingWindow } from './components/onboarding/OnboardingWindow'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OnboardingWindow />
  </React.StrictMode>
)
