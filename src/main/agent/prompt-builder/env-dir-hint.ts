import os from 'os'
import type { PromptLanguage } from './types'

/**
 * 返回智能体环境目录路径（读取主进程设置的环境变量）
 */
function getAgentEnvDir(): string {
  return process.env.NEXUS_AGENT_ENV_DIR || ''
}

/**
 * 根据实际运行环境推导出 ~ 下的 Nexus 目录路径（如 ~/.Nexus/env 或 ~/.Nexus_dev/env）
 */
function resolveNexusEnvPath(): string {
  const envDir = getAgentEnvDir()
  if (!envDir) return '~/.Nexus/env'

  const home = os.homedir()
  const relative = envDir.replace(home, '')
  return '~' + relative
}

/**
 * 构建智能体环境目录提示
 */
export function buildEnvDirHint(language: PromptLanguage): string {
  const envDir = getAgentEnvDir()
  const nexusEnvPath = resolveNexusEnvPath()
  switch (language) {
    case 'zh':
      return (
        `# 智能体环境目录\n`
        + `你的专用工作区，用于存放临时脚本、虚拟环境、构建产物和运行时文件： \`${nexusEnvPath}\`（已解析：\`${envDir}\`）。\n`
        + `- 在此创建临时脚本（例如 \`${nexusEnvPath}/temp_analysis.py\`）\n`
        + `- 在此设置 Python venv / Node.js node_modules（需要时）\n`
        + `- 在此存储中间数据文件、下载资源和构建产物\n`
        + `- 不要在用户主目录或项目目录中散布临时文件\n`
        + `- 你可以根据需要自由创建和删除此目录中的文件`
      )
    case 'fr':
      return (
        "# Répertoire de l'environnement agent\n"
        + `Ton espace de travail dédié pour les scripts temporaires, les environnements virtuels, les artefacts de build et les fichiers d'exécution : \`${nexusEnvPath}\` (résolu : \`${envDir}\`).\n`
        + `- Crée ici les scripts temporaires (ex. \`${nexusEnvPath}/temp_analysis.py\`)\n`
        + "- Configure ici les environnements Python venv / Node.js node_modules (si nécessaire)\n"
        + "- Stocke ici les fichiers de données intermédiaires, les ressources téléchargées et les artefacts de build\n"
        + "- Ne disperse pas de fichiers temporaires dans le répertoire personnel de l'utilisateur ou les répertoires de projet\n"
        + "- Tu peux librement créer et supprimer des fichiers dans ce répertoire selon tes besoins"
      )
    case 'es':
      return (
        `# Directorio de Entorno del Agente\n`
        + `Tu espacio de trabajo dedicado para almacenar scripts temporales, entornos virtuales, artefactos de compilación y archivos de ejecución: \`${nexusEnvPath}\` (resuelto: \`${envDir}\`).\n`
        + `- Crea scripts temporales aquí (por ejemplo, \`${nexusEnvPath}/temp_analysis.py\`)\n`
        + `- Configura Python venv / Node.js node_modules aquí cuando sea necesario\n`
        + `- Almacena archivos de datos intermedios, recursos descargados y artefactos de compilación aquí\n`
        + `- No disperses archivos temporales por el directorio home o de proyecto del usuario\n`
        + `- Siéntete libre de crear y eliminar archivos en este directorio según sea necesario`
      )
    default:
      return (
        `# Agent Environment Directory\n`
        + `Your dedicated workspace for storing temporary scripts, virtual environments, build artifacts, and runtime files: \`${nexusEnvPath}\` (resolved: \`${envDir}\`).\n`
        + `- Create temporary scripts here (e.g., \`${nexusEnvPath}/temp_analysis.py\`)\n`
        + `- Set up Python venv / Node.js node_modules here when needed\n`
        + `- Store intermediate data files, downloaded resources, and build artifacts here\n`
        + `- Do not scatter temporary files across the user's home or project directories\n`
        + `- Feel free to create and delete files in this directory as needed`
      )
  }
}
