/**
 * 文件查看器相关常量和工具函数
 * 从 FileBrowserPanel.tsx 提取
 */

/** 文件类型 */
export type FileType = 'text' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'ppt'

/** 支持查看的文件扩展名白名单（文本/代码类文件） */
export const SUPPORTED_EXTENSIONS = new Set([
  // 编程语言
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt',
  'swift', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish',
  'ps1', 'bat', 'cmd', 'lua', 'pl', 'r', 'dart', 'scala', 'groovy', 'clj',
  'erl', 'ex', 'exs', 'hs', 'ml', 'mli', 'vue', 'svelte',
  // 配置/数据格式
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'env',
  'csv', 'tsv', 'sql', 'graphql', 'gql', 'proto',
  // 标记/文档
  'md', 'mdx', 'txt', 'log', 'rst', 'tex', 'html', 'htm', 'css', 'scss', 'sass',
  'less', 'styl', 'svg',
  // Git/编辑器
  'gitignore', 'gitattributes', 'editorconfig', 'prettierrc', 'eslintrc',
  // Docker/K8s
  'dockerfile', 'makefile',
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'tif',
  // Office 文档
  'docx', 'xlsx', 'xls', 'pptx', 'ppt',
  // PDF
  'pdf',
])

/** 图片扩展名集合 */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'tif',
])

/** 根据扩展名判断文件类型 */
export function getFileType(fileName: string): FileType {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'ppt' || ext === 'pptx') return 'ppt'
  return 'text'
}

/** 展开路径中的 ~ 为用户主目录 */
let _cachedHomeDir: string | null = null

/** 异步获取主目录（渲染进程版本，通过 app.getPath IPC） */
export async function fetchHomeDir(): Promise<void> {
  if (!_cachedHomeDir) {
    try {
      _cachedHomeDir = await window.electronAPI.app.getPath('home')
    } catch {
      // 忽略错误
    }
  }
}

/** 同步展开 ~，依赖 _cachedHomeDir 已初始化 */
export function expandTildeSync(input: string): string {
  if (!input.startsWith('~') || !_cachedHomeDir) return input
  return _cachedHomeDir + input.slice(1)
}
