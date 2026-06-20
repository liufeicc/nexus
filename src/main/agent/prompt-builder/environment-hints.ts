import os from 'os'
import type { PromptLanguage } from './types'

/**
 * 检测运行环境并返回环境提示
 */
export function buildEnvironmentHints(language: PromptLanguage): string {
  const plat = os.platform()

  if (plat === 'linux') {
    const release = os.release().toLowerCase()
    if (release.includes('microsoft') || release.includes('wsl')) {
      switch (language) {
        case 'zh':
          return (
            '你运行在 WSL（Windows 子系统 Linux）环境中。'
            + 'Windows 主机文件系统挂载在 /mnt/ 下 — '
            + '/mnt/c/ 是 C 盘，/mnt/d/ 是 D 盘，以此类推。'
            + '用户的 Windows 文件通常位于 '
            + '/mnt/c/Users/<用户名>/Desktop/、Documents/、Downloads/ 等位置。'
            + '当用户引用 Windows 路径或桌面文件时，请转换为 /mnt/c/ 下的对应路径。'
          )
        case 'fr':
          return (
            "Tu fonctionnes dans un environnement WSL (Sous-système Windows pour Linux). "
            + "Le système de fichiers hôte Windows est monté sous /mnt/ — "
            + "/mnt/c/ correspond au disque C, /mnt/d/ au disque D, et ainsi de suite. "
            + "Les fichiers Windows de l'utilisateur se trouvent généralement dans "
            + "/mnt/c/Users/<nom-utilisateur>/Desktop/, Documents/, Downloads/, etc. "
            + "Lorsque l'utilisateur fait référence à des chemins Windows ou à des fichiers sur le bureau, "
            + "convertis-les en chemins correspondants sous /mnt/."
          )
        case 'es':
          return (
            'Te ejecutas en un entorno WSL (Subsistema de Windows para Linux). '
            + 'El sistema de archivos del anfitrión Windows está montado bajo /mnt/ — '
            + '/mnt/c/ es la unidad C, /mnt/d/ es la unidad D, y así sucesivamente. '
            + 'Los archivos de Windows del usuario suelen ubicarse en '
            + '/mnt/c/Users/<nombre>/Desktop/, Documents/, Downloads/, etc. '
            + 'Cuando el usuario haga referencia a una ruta de Windows o un archivo del escritorio, '
            + 'conviértela a la ruta correspondiente bajo /mnt/c/.'
          )
        default:
          return (
            'You are running in WSL (Windows Subsystem for Linux). '
            + 'The Windows host filesystem is mounted under /mnt/ — '
            + '/mnt/c/ is the C drive, /mnt/d/ is the D drive, and so on. '
            + 'Windows user files are typically located at '
            + '/mnt/c/Users/<username>/Desktop/, Documents/, Downloads/, etc. '
            + 'When the user references a Windows path or desktop file, '
            + 'convert it to the corresponding path under /mnt/c/.'
          )
      }
    }
    return ''
  }

  if (plat === 'darwin') {
    switch (language) {
      case 'zh':
        return (
          '你运行在 macOS 系统上。请使用标准 macOS 路径和约定。'
          + '用户文件通常位于 ~/Desktop、~/Documents、~/Downloads 等位置。'
        )
      case 'fr':
        return (
          "Tu fonctionnes sur un système macOS. Utilise les chemins et conventions standard de macOS. "
          + "Les fichiers de l'utilisateur se trouvent généralement dans ~/Desktop, ~/Documents, ~/Downloads, etc."
        )
      case 'es':
        return (
          'Te ejecutas en un sistema macOS. Usa rutas y convenciones estándar de macOS. '
          + 'Los archivos del usuario suelen ubicarse en ~/Desktop, ~/Documents, ~/Downloads, etc.'
        )
      default:
        return (
          'You are running on macOS. Use standard macOS paths and conventions. '
          + 'User files are typically located at ~/Desktop, ~/Documents, ~/Downloads, etc.'
        )
    }
  }

  if (plat === 'win32') {
    switch (language) {
      case 'zh':
        return (
          '你运行在 Windows 系统上。请使用 Windows 路径（C:\\Users\\...）和约定。'
          + '注意路径分隔符 — 使用双反斜杠或正斜杠。'
        )
      case 'fr':
        return (
          "Tu fonctionnes sur un système Windows. Utilise les chemins Windows (C:\\Users\\...) et les conventions associées. "
          + "Fais attention aux séparateurs de chemin — utilise des doubles antislashs ou des slashes directs."
        )
      case 'es':
        return (
          'Te ejecutas en un sistema Windows. Usa rutas de Windows (C:\\Users\\...) y convenciones. '
          + 'Presta atención a los separadores de ruta — usa doble barra invertida o barras diagonales.'
        )
      default:
        return (
          'You are running on Windows. Use Windows paths (C:\\Users\\...) and conventions. '
          + 'Pay attention to path separators — use double backslashes or forward slashes.'
        )
    }
  }

  return ''
}
