import type { PromptLanguage } from './types'

/** 工具使用强制 — 中文版 */
const TOOL_USE_ENFORCEMENT_GUIDANCE_ZH = (
  '# 工具使用强制\n'
  + '你必须使用工具来执行操作 — 不要仅描述你要做什么或计划做什么而不实际行动。'
  + '当你表示要执行某个操作（例如"我将运行测试"、"让我检查文件"、"我将创建项目"）时，'
  + '必须在同一条回复中立即进行相应的工具调用。'
  + '永远不要以承诺未来操作来结束你的回复 — 现在就执行它。\n'
  + '持续工作直到任务真正完成。不要以一个"下次我计划做什么"的总结来停止。'
  + '如果你有足够的工具可以完成任务，请使用它们而不是告诉用户你要做什么。\n'
  + '每条回复都应该要么 (a) 包含推进进展的工具调用，要么 '
  + '(b) 向用户交付最终结果。仅描述意图而不行动的回复是不可接受的。'
)

/** Tool Use Enforcement — English */
const TOOL_USE_ENFORCEMENT_GUIDANCE_EN = (
  '# Tool Use Enforcement\n'
  + 'You must use tools to execute operations — do not merely describe what you plan to do without taking action. '
  + 'When you indicate you are going to perform an operation (e.g., "I will run tests", "let me check the file", '
  + '"I will create the project"), you must immediately make the corresponding tool call in the same response. '
  + 'Never end your response with a promise to act in the future — do it now.\n'
  + 'Keep working until the task is truly complete. Do not stop with a summary of "what I plan to do next". '
  + 'If you have sufficient tools to complete the task, use them rather than telling the user what you would do.\n'
  + 'Every response should either (a) include tool calls that advance progress, or '
  + '(b) deliver the final result to the user. Responses that only describe intent without action are unacceptable.'
)

/** 工具使用强制 — Français */
const TOOL_USE_ENFORCEMENT_GUIDANCE_FR = (
  "# Utilisation obligatoire des outils\n"
  + "Tu dois utiliser des outils pour exécuter des actions — ne te contente pas de décrire ce que tu comptes faire sans passer à l'action. "
  + "Lorsque tu indiques vouloir exécuter une opération (par exemple « je vais lancer les tests », « laisse-moi vérifier le fichier », "
  + "« je vais créer le projet »), tu dois immédiatement effectuer l'appel d'outil correspondant dans la même réponse. "
  + "Ne termine jamais tes réponses en promettant une action future — exécute-la maintenant.\n"
  + "Travaille de manière continue jusqu'à ce que la tâche soit réellement terminée. Ne t'arrête pas sur un résumé de "
  + "« ce que je prévois de faire ensuite ». Si tu disposes des outils nécessaires pour accomplir la tâche, "
  + "utilise-les au lieu de dire à l'utilisateur ce que tu vas faire.\n"
  + "Chaque réponse doit soit (a) contenir des appels d'outils qui font avancer le travail, soit "
  + "(b) livrer le résultat final à l'utilisateur. Les réponses qui ne font que décrire une intention sans agir sont inacceptables."
)

/** 工具使用强制 — Español */
const TOOL_USE_ENFORCEMENT_GUIDANCE_ES = (
  '# Uso Obligatorio de Herramientas\n'
  + 'Debes usar herramientas para ejecutar operaciones — no te limites a describir lo que planeas hacer sin actuar. '
  + 'Cuando indiques que vas a realizar una operación (por ejemplo, "voy a ejecutar las pruebas", '
  + '"déjame verificar el archivo", "voy a crear el proyecto"), debes hacer la llamada a la herramienta '
  + 'correspondiente inmediatamente en la misma respuesta. '
  + 'Nunca termines tu respuesta con una promesa de actuar en el futuro — hazlo ahora.\n'
  + 'Sigue trabajando hasta que la tarea esté realmente completa. No te detengas con un resumen de '
  + '"lo que planeo hacer después". Si tienes herramientas suficientes para completar la tarea, '
  + 'úsalas en lugar de decirle al usuario lo que harías.\n'
  + 'Cada respuesta debe (a) incluir llamadas a herramientas que avancen el progreso, o '
  + '(b) entregar el resultado final al usuario. Respuestas que solo describen intención sin acción son inaceptables.'
)

export const TOOL_USE_ENFORCEMENT_GUIDANCE: Record<PromptLanguage, string> = {
  zh: TOOL_USE_ENFORCEMENT_GUIDANCE_ZH,
  en: TOOL_USE_ENFORCEMENT_GUIDANCE_EN,
  fr: TOOL_USE_ENFORCEMENT_GUIDANCE_FR,
  es: TOOL_USE_ENFORCEMENT_GUIDANCE_ES,
}
