/**
 * 主题配置
 */

export interface Theme {
  id: string
  name: string
  icon: string
  colors: {
    bgPrimary: string
    bgSecondary: string
    bgTertiary: string
    bgSidebar: string
    bgToolbar: string
    textPrimary: string
    textSecondary: string
    textMuted: string
    accentColor: string
    accentHover: string
    borderColor: string
    hoverBg: string
  }
}

export const themes: Theme[] = [
  {
    id: 'light',
    name: '暖阳',
    icon: 'sun',
    colors: {
      bgPrimary: '#f5f5f5',
      bgSecondary: '#ffffff',
      bgTertiary: '#e0e0e0',
      bgSidebar: '#e0e0e0',
      bgToolbar: '#ffffff',
      textPrimary: '#333333',
      textSecondary: '#666666',
      textMuted: '#888888',
      accentColor: '#007acc',
      accentHover: '#005f9e',
      borderColor: '#cccccc',
      hoverBg: 'rgba(0, 0, 0, 0.06)',
    },
  },
  {
    id: 'deepblue',
    name: '深蓝',
    icon: 'moon',
    colors: {
      bgPrimary: '#0a1f3c',
      bgSecondary: '#0d284a',
      bgTertiary: '#163a66',
      bgSidebar: '#0d284a',
      bgToolbar: '#13325c',
      textPrimary: '#a8c5e8',
      textSecondary: '#7a9cc6',
      textMuted: '#5a7a9a',
      accentColor: '#4a90d9',
      accentHover: '#3a7bc8',
      borderColor: '#1f4a7a',
      hoverBg: 'rgba(255, 255, 255, 0.08)',
    },
  },
  {
    id: 'green',
    name: '森林',
    icon: 'tree',
    colors: {
      bgPrimary: '#0d1a0d',
      bgSecondary: '#102110',
      bgTertiary: '#163316',
      bgSidebar: '#102110',
      bgToolbar: '#142b14',
      textPrimary: '#8fbf8f',
      textSecondary: '#6a9f6a',
      textMuted: '#5a7a5a',
      accentColor: '#4caf50',
      accentHover: '#43a047',
      borderColor: '#1f3a1f',
      hoverBg: 'rgba(255, 255, 255, 0.08)',
    },
  },
  {
    id: 'ocean',
    name: '海洋',
    icon: 'wave',
    colors: {
      bgPrimary: '#e8f4f8',
      bgSecondary: '#ffffff',
      bgTertiary: '#d4ebf5',
      bgSidebar: '#f0f8fb',
      bgToolbar: '#ffffff',
      textPrimary: '#2c5270',
      textSecondary: '#5a8a9a',
      textMuted: '#8fb3c5',
      accentColor: '#63b3e4',
      accentHover: '#4aa3d8',
      borderColor: '#b8e0f0',
      hoverBg: 'rgba(0, 0, 0, 0.06)',
    },
  },
  {
    id: 'sunset',
    name: '日落',
    icon: 'sunset',
    colors: {
      bgPrimary: '#fff8f0',
      bgSecondary: '#ffffff',
      bgTertiary: '#ffe8d0',
      bgSidebar: '#fff5eb',
      bgToolbar: '#ffffff',
      textPrimary: '#7c4a2e',
      textSecondary: '#b58a6a',
      textMuted: '#d4a580',
      accentColor: '#f59e5a',
      accentHover: '#f08540',
      borderColor: '#f5d5b5',
      hoverBg: 'rgba(0, 0, 0, 0.06)',
    },
  },
  {
    id: 'pink',
    name: '樱花',
    icon: 'flower',
    colors: {
      bgPrimary: '#fff8fc',
      bgSecondary: '#ffffff',
      bgTertiary: '#fce4ec',
      bgSidebar: '#fdf2f8',
      bgToolbar: '#fff0f6',
      textPrimary: '#5a4a4a',
      textSecondary: '#8a6a7a',
      textMuted: '#b89ab0',
      accentColor: '#f48fb1',
      accentHover: '#f06292',
      borderColor: '#e8c5c5',
      hoverBg: 'rgba(0, 0, 0, 0.06)',
    },
  },
]

/**
 * 应用主题到 CSS 变量
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const colors = theme.colors

  root.style.setProperty('--bg-primary', colors.bgPrimary)
  root.style.setProperty('--bg-secondary', colors.bgSecondary)
  root.style.setProperty('--bg-tertiary', colors.bgTertiary)
  root.style.setProperty('--bg-sidebar', colors.bgSidebar)
  root.style.setProperty('--bg-toolbar', colors.bgToolbar)
  root.style.setProperty('--text-primary', colors.textPrimary)
  root.style.setProperty('--text-secondary', colors.textSecondary)
  root.style.setProperty('--text-muted', colors.textMuted)
  root.style.setProperty('--accent-color', colors.accentColor)
  root.style.setProperty('--accent-hover', colors.accentHover)
  root.style.setProperty('--border-color', colors.borderColor)
  root.style.setProperty('--hover-bg', colors.hoverBg)

  // 设置 data-theme 属性，方便 CSS 按主题选择器
  root.setAttribute('data-theme', theme.id)
}
