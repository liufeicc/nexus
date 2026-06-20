/**
 * Nexus 面板管理模块
 *
 * 功能说明：
 * 1. 创建新面板
 * 2. 面板聚焦管理
 * 3. 面板关闭功能
 * 4. 面板操作（复制/粘贴）
 */

// 面板计数器（用于生成唯一面板 ID）
let panelCounter = 4;

// 引用 session.js 中的全局变量（用于树形布局）
// selectedPanelId - 当前选中的面板 ID（在 session.js 中定义）

// 记录上一个获得焦点的面板 ID（用于关闭面板时恢复焦点）
let lastFocusedPanelId = null;

/**
 * 创建新面板并初始化终端
 * @param {string} sessionPath - 会话路径
 * @param {boolean} hideOthers - 是否隐藏其他面板（用于会话切换），新增面板时为 false
 * @returns {string} 新面板的 ID
 */
function createPanel(sessionPath, hideOthers = false) {
    const panelsContainer = document.getElementById('panels-container');
    console.log('[面板管理] 开始创建面板，sessionPath:', sessionPath, 'hideOthers:', hideOthers);
    console.log('[面板管理] 面板容器:', panelsContainer);

    if (!panelsContainer) {
        console.error('[面板管理] 面板容器不存在!');
        return null;
    }

    // 设置容器为 flex 布局
    panelsContainer.classList.add('flex');
    panelsContainer.classList.remove('items-center', 'justify-center', 'grid');
    console.log('[面板管理] 设置面板容器样式');

    // 移除空状态提示（如果存在）
    const emptyStateEl = panelsContainer.querySelector('div.flex-1.flex.items-center.justify-center.text-gray-500');
    if (emptyStateEl) {
        emptyStateEl.remove();
        console.log('[面板管理] 已移除空状态提示');
    }

    // 只有在 hideOthers 为 true 时才隐藏其他面板（用于会话切换）
    if (hideOthers) {
        const existingContainers = document.querySelectorAll('.terminal-container');
        existingContainers.forEach(container => {
            container.style.display = 'none';
        });
        console.log('[面板管理] 已隐藏所有已存在的面板，数量:', existingContainers.length);
    }

    // 生成唯一面板 ID
    panelCounter++;
    const panelId = `terminal-${Date.now()}`;
    const panelIndex = panelCounter;
    console.log('[面板管理] 生成的 panelId:', panelId, 'panelIndex:', panelIndex);

    // 创建面板 HTML（外层容器添加 id 属性）
    const panelHTML = `
        <div id="${panelId}-container" class="terminal-container flex flex-col" data-xterm-id="${panelIndex}" style="display: flex; flex-direction: column; height: 100%;">
            <div class="panel-header" style="background-color: var(--bg-toolbar); border-bottom-color: var(--border-color); color: var(--text-primary); display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; cursor: grab; user-select: none;">
                <div class="flex items-center gap-2" style="cursor: grab;">
                    <div class="w-3 h-3 rounded-full bg-green-500"></div>
                    <span class="text-gray-300 font-medium">bash - ${sessionPath}</span>
                </div>
                <div class="panel-controls">
                    <!-- 面板 AI 小松鼠（扳手图标，关闭按钮左边） -->
                    <span class="panel-ai-squirrel" title="开启面板 AI 助手">🐿️<span class="panel-ai-wrench">🔧</span></span>
                    <button class="panel-btn" onclick="closePanelFromHeader(this)">关闭</button>
                </div>
            </div>
            <div id="${panelId}" class="flex-1" style="min-height: 0; overflow: hidden;"></div>
        </div>
    `;

    console.log('[面板管理] 面板 HTML:', panelHTML);

    // 添加到容器
    panelsContainer.insertAdjacentHTML('beforeend', panelHTML);
    console.log('[面板管理] 面板已添加到容器');

    // 先显示面板容器（确保终端元素有尺寸）
    const containerEl = document.getElementById(`${panelId}-container`);
    console.log('[面板管理] 查找容器元素:', `${panelId}-container`, '结果:', containerEl);

    if (containerEl) {
        containerEl.style.display = 'flex';
        console.log('[面板管理] 面板容器已显示');
    } else {
        console.error('[面板管理] 未找到容器元素!');
    }

    // 等待 DOM 渲染后再初始化终端
    console.log('[面板管理] 设置 setTimeout 等待终端初始化');
    setTimeout(() => {
        console.log('[面板管理] setTimeout 回调执行，开始初始化终端');
        // 初始化终端
        const element = document.getElementById(panelId);
        console.log('[面板管理] 终端元素:', element);
        if (element) {
            console.log('[面板管理] 开始初始化终端，元素:', element);

            // 确保终端元素显示
            element.style.display = 'block';
            element.style.height = '100%';
            element.style.minHeight = '0';

            const term = new Terminal({
                fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
                fontSize: 14,
                lineHeight: 1.2,
                cursorBlink: true,
                cursorStyle: 'block',
                theme: {
                    background: '#000000',
                    foreground: '#ffffff'
                }
            });
            term.open(element);

            // 等待终端渲染完成
            setTimeout(() => {
                term.focus();

                // 保存终端实例
                terminals[panelId] = term;
                console.log('[面板管理] 终端已初始化，元素尺寸:', element.offsetWidth, 'x', element.offsetHeight);
                console.log('[面板管理] 终端尺寸:', term.rows, 'x', term.cols);

                // 写入欢迎信息 - 色调与主题一致
                const welcomeMessage = [
                    '\x1b[32m 欢迎使用 Nexus\x1b[0m',
                    'Terminal Version: ' + term.rows + 'x' + term.cols,
                    'Shell: bash 5.1.8',
                    'Working Directory: ' + sessionPath,
                    'Connected to: localhost',
                    '',
                    '\x1b[33m 提示：\x1b[0m 这是一个模拟的终端，可用于输入命令',
                    '输入 \x1b[32mclear\x1b[0m 清屏，输入 \x1b[32mhelp\x1b[0m 查看帮助',
                    '',
                ];

                term.write(welcomeMessage.join('\r\n') + '\r\n');
                console.log('[面板管理] 欢迎信息已写入');

                // 终端输入处理
                term.onData((data) => {
                    term.write('\r\n' + data);
                    if (data === 'clear\n' || data === 'cls\n') {
                        term.clear();
                    } else if (data === 'help\n') {
                        term.write('\r\n\x1b[32m 可用命令:\x1b[0m');
                        term.write('\r\n  clear   - 清除屏幕');
                        term.write('\r\n  help    - 显示帮助');
                        term.write('\r\n  ls      - 列出目录');
                        term.write('\r\n  pwd     - 显示当前目录');
                        term.write('\r\n  date    - 显示日期');
                        term.write('\r\n');
                    } else if (data === 'ls\n') {
                        term.write('\r\n\x1b[36mDesktop\x1b[0m   \x1b[34mDocuments\x1b[0m   \x1b[34mDownloads\x1b[0m   \x1b[34mProjects\x1b[0m\r\n');
                    } else if (data === 'pwd\n') {
                        term.write('\r\n\x1b[36m' + sessionPath + '\x1b[0m\r\n');
                    } else if (data === 'date\n') {
                        term.write('\r\n' + new Date().toString() + '\r\n');
                    }
                });
            }, 200);
        }
    });

    return panelId;
}

/**
 * 创建文件浏览器面板的 DOM 容器（不插入到 DOM，由调用方处理）
 * @param {string} rootPath - 文件面板的根目录路径
 * @param {boolean} hideOthers - 是否隐藏其他面板
 * @returns {{panelId: string, container: HTMLElement}|null} 面板 ID 和容器元素
 */
function createFilePanelElement(rootPath, hideOthers = false) {
    const panelsContainer = document.getElementById('panels-container');
    console.log('[文件面板] 开始创建文件面板，rootPath:', rootPath);

    if (!panelsContainer) {
        console.error('[文件面板] 面板容器不存在!');
        return null;
    }

    panelsContainer.classList.add('flex');
    panelsContainer.classList.remove('items-center', 'justify-center', 'grid');

    const emptyStateEl = panelsContainer.querySelector('div.flex-1.flex.items-center.justify-center.text-gray-500');
    if (emptyStateEl) emptyStateEl.remove();

    if (hideOthers) {
        const existingContainers = document.querySelectorAll('.terminal-container');
        existingContainers.forEach(c => c.style.display = 'none');
    }

    const panelId = `file-${Date.now()}`;
    const rootName = rootPath.split('/').pop() || rootPath;

    // 创建文件面板容器（不插入到 DOM）
    const container = document.createElement('div');
    container.id = `${panelId}-container`;
    container.className = 'terminal-container flex flex-col file-panel-container';
    container.setAttribute('data-panel-type', 'file');
    container.style.cssText = 'display: flex; flex-direction: column; height: 100%; background: var(--bg-primary);';

    // 头部
    container.innerHTML = `
        <div class="panel-header" style="background-color: var(--bg-toolbar); border-bottom-color: var(--border-color); color: var(--text-primary); display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; cursor: grab; user-select: none;">
            <div class="flex items-center gap-2" style="cursor: grab;">
                <svg class="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
                <span class="font-medium" style="color: var(--text-primary);">文件浏览器 - ${rootName}</span>
            </div>
            <div class="panel-controls">
                <button class="panel-btn" onclick="closeFilePanel('${panelId}')" style="background: none; border: none; color: var(--text-primary); cursor: pointer; padding: 2px 8px; border-radius: 3px;">关闭</button>
            </div>
        </div>
        <div class="file-breadcrumb" style="min-height: 32px; max-height: 32px; display: flex !important; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--border-color); gap: 4px; font-size: 13px; color: var(--text-primary); background: var(--bg-toolbar); overflow: visible !important; flex: 0 0 32px !important;" data-root-path="${rootPath}" data-current-path="${rootPath}">
            <span class="breadcrumb-segment" style="color: var(--accent); cursor: pointer; padding: 2px 4px; border-radius: 3px;">📁 ${rootName}</span>
        </div>
        <div class="file-grid" style="flex: 1; padding: 12px; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 8px; overflow-y: auto;">
            <div style="width:100%;text-align:center;padding:24px;color:var(--text-muted);">加载文件列表中...</div>
        </div>
        <div class="file-statusbar" style="height: 28px; min-height: 28px; max-height: 28px; display: flex; align-items: center; padding: 0 6px; border-top: 1px solid var(--border-color); background: var(--bg-toolbar); gap: 2px; overflow-x: auto; overflow-y: hidden; flex-shrink: 0;" data-panel-id="${panelId}">
            <span class="file-statusbar-empty" style="font-size: 11px; color: var(--text-muted); padding: 0 4px;">未打开文件</span>
        </div>
    `;

    // 绑定面板点击聚焦事件
    container.addEventListener('click', (e) => {
        if (!e.target.closest('.panel-btn')) {
            document.querySelectorAll('.terminal-container').forEach(c => c.classList.remove('focused'));
            container.classList.add('focused');
        }
    });

    console.log('[文件面板] 已创建文件面板容器:', panelId);
    return { panelId, container };
}

/**
 * 关闭文件面板
 * @param {string} panelId - 文件面板 ID
 */
function closeFilePanel(panelId) {
    console.log('[文件面板] 关闭面板:', panelId);
    const container = document.getElementById(`${panelId}-container`);
    if (container) {
        // 复用终端面板的 closePanel 逻辑，确保布局树更新、会话状态同步
        closePanel(container);
    }
}

/**
 * 每个文件面板的打开文件状态（按 panelId 存储）
 * openFilesMap = {
 *   'file-xxx': {
 *     openFiles: [{ path, name, content }],
 *     activeIndex: 0
 *   }
 * }
 */
const openFilesMap = {};

/**
 * 打开文件（双击文件时调用）
 * @param {string} panelId - 文件面板 ID
 * @param {string} filePath - 文件完整路径
 * @param {string} fileName - 文件名
 * @param {string} rootPath - 文件面板根路径
 * @param {string} currentPath - 当前浏览的目录路径
 */
function openFile(panelId, filePath, fileName, rootPath, currentPath) {
    console.log('[文件面板] 打开文件:', fileName, '路径:', filePath);

    // 初始化该面板的打开文件状态
    if (!openFilesMap[panelId]) {
        openFilesMap[panelId] = { openFiles: [], activeIndex: -1 };
    }

    const state = openFilesMap[panelId];

    // 检查文件是否已打开，如果已打开则切换到该文件
    const existingIndex = state.openFiles.findIndex(f => f.path === filePath);
    if (existingIndex !== -1) {
        state.activeIndex = existingIndex;
        showFileViewer(panelId, rootPath, currentPath);
        renderStatusBar(panelId);
        return;
    }

    // 模拟文件内容（原型阶段，后续替换为 Electron API）
    const content = mockFileContent(filePath, fileName);

    // 添加到打开列表
    state.openFiles.push({ path: filePath, name: fileName, content });
    state.activeIndex = state.openFiles.length - 1;

    // 切换到文件查看视图
    showFileViewer(panelId, rootPath, currentPath);
    renderStatusBar(panelId);
}

/**
 * 关闭指定文件
 * @param {string} panelId - 文件面板 ID
 * @param {string} filePath - 要关闭的文件路径
 */
function closeFile(panelId, filePath) {
    console.log('[文件面板] 关闭文件:', filePath);

    const state = openFilesMap[panelId];
    if (!state) return;

    const index = state.openFiles.findIndex(f => f.path === filePath);
    if (index === -1) return;

    state.openFiles.splice(index, 1);

    // 调整 activeIndex
    if (state.openFiles.length === 0) {
        state.activeIndex = -1;
        // 没有已打开文件，回到文件网格
        hideFileViewer(panelId);
    } else if (index <= state.activeIndex) {
        state.activeIndex = Math.max(0, state.activeIndex - 1);
        // 如果关闭的是当前查看的文件，切换到新的 activeIndex
        const container = document.getElementById(`${panelId}-container`);
        if (container) {
            const rootPath = container.querySelector('.file-breadcrumb')?.getAttribute('data-root-path') || '';
            const currentPath = container.querySelector('.file-breadcrumb')?.getAttribute('data-current-path') || '';
            showFileViewer(panelId, rootPath, currentPath);
        }
    }

    renderStatusBar(panelId);
}

/**
 * 显示文件查看器（替换文件网格区域）
 */
function showFileViewer(panelId, rootPath, currentPath) {
    const container = document.getElementById(`${panelId}-container`);
    if (!container) return;

    const state = openFilesMap[panelId];
    if (!state || state.activeIndex < 0 || state.activeIndex >= state.openFiles.length) return;

    const file = state.openFiles[state.activeIndex];

    // 隐藏文件网格
    const grid = container.querySelector('.file-grid');
    if (!grid) return;

    // 检查是否已有查看器
    let viewer = grid.querySelector('.file-viewer');
    if (!viewer) {
        // 创建查看器
        viewer = document.createElement('div');
        viewer.className = 'file-viewer';
        viewer.style.cssText = 'flex:1; display:flex; flex-direction:column; min-height:0;';
        grid.style.display = 'flex';
        grid.style.padding = '0';
        grid.appendChild(viewer);
    }

    // 顶部文件名标签
    let header = viewer.querySelector('.file-viewer-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'file-viewer-header';
        header.style.cssText = 'height:28px; min-height:28px; display:flex; align-items:center; padding:0 12px; border-bottom:1px solid var(--border-color); background:var(--bg-toolbar); font-size:12px; color:var(--text-primary); gap:8px;';
        viewer.appendChild(header);
    }
    header.innerHTML = `
        <svg class="w-3 h-3" style="width:12px;height:12px;color:var(--accent);" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/>
        </svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</span>
        <button class="file-viewer-close-btn" onclick="closeFile('${panelId}', '${file.path}')"
                style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--text-muted);cursor:pointer;border-radius:3px;font-size:16px;line-height:1;transition:all 0.15s;"
                onmouseover="this.style.backgroundColor='var(--hover-bg)';this.style.color='var(--text-primary)'"
                onmouseout="this.style.backgroundColor='transparent';this.style.color='var(--text-muted)'"
                title="关闭文件">
            <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        </button>
    `;

    // 文本内容区
    let content = viewer.querySelector('.file-viewer-content');
    if (!content) {
        content = document.createElement('div');
        content.className = 'file-viewer-content';
        content.style.cssText = 'flex:1; min-height:0; overflow:auto; padding:12px;';
        viewer.appendChild(content);
    }
    content.innerHTML = `<pre style="margin:0; font-family:'Fira Code','Consolas','Monaco',monospace; font-size:13px; line-height:1.5; color:var(--text-primary); white-space:pre; tab-size:4;">${escapeHtml(file.content)}</pre>`;

    // 隐藏网格中的文件列表（保留网格作为容器）
    const fileList = grid.querySelector('.file-grid-content');
    if (fileList) fileList.style.display = 'none';

    // 显示查看器
    viewer.style.display = 'flex';

    console.log('[文件面板] 文件查看器已显示:', file.name);
}

/**
 * 隐藏文件查看器，回到文件网格
 */
function hideFileViewer(panelId) {
    const container = document.getElementById(`${panelId}-container`);
    if (!container) return;

    const grid = container.querySelector('.file-grid');
    if (!grid) return;

    // 隐藏查看器
    const viewer = grid.querySelector('.file-viewer');
    if (viewer) viewer.style.display = 'none';

    // 显示文件列表
    const fileList = grid.querySelector('.file-grid-content');
    if (fileList) fileList.style.display = '';

    // 恢复网格样式
    grid.style.padding = '12px';

    console.log('[文件面板] 已隐藏文件查看器');
}

/**
 * 渲染文件状态栏
 */
function renderStatusBar(panelId) {
    const container = document.getElementById(`${panelId}-container`);
    if (!container) return;

    const statusBar = container.querySelector('.file-statusbar');
    if (!statusBar) return;

    const state = openFilesMap[panelId];
    if (!state || state.openFiles.length === 0) {
        statusBar.innerHTML = '<span class="file-statusbar-empty" style="font-size:11px;color:var(--text-muted);padding:0 4px;">未打开文件</span>';
        return;
    }

    let html = '';
    state.openFiles.forEach((file, index) => {
        const isActive = index === state.activeIndex;
        html += `
            <div class="file-statusbar-item ${isActive ? 'active' : ''}"
                 data-file-path="${file.path}"
                 onclick="switchToFile('${panelId}', '${file.path}')"
                 style="${isActive ? '' : ''}">
                <svg class="file-icon" style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/>
                </svg>
                <span class="file-name">${file.name}</span>
                <span class="file-close" onclick="event.stopPropagation(); closeFile('${panelId}', '${file.path}')">
                    <svg style="width:10px;height:10px;" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </span>
            </div>
        `;
    });

    statusBar.innerHTML = html;
}

/**
 * 从状态栏切换到指定文件
 */
function switchToFile(panelId, filePath) {
    console.log('[文件面板] 切换到文件:', filePath);

    const state = openFilesMap[panelId];
    if (!state) return;

    const index = state.openFiles.findIndex(f => f.path === filePath);
    if (index === -1) return;

    state.activeIndex = index;

    const container = document.getElementById(`${panelId}-container`);
    if (container) {
        const rootPath = container.querySelector('.file-breadcrumb')?.getAttribute('data-root-path') || '';
        const currentPath = container.querySelector('.file-breadcrumb')?.getAttribute('data-current-path') || '';
        showFileViewer(panelId, rootPath, currentPath);
    }
    renderStatusBar(panelId);
}

/**
 * 模拟文件内容（原型阶段使用）
 */
function mockFileContent(filePath, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();

    const contents = {
        'js': `// ${fileName}
import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App);
app.mount('#app');

console.log('App started');`,
        'ts': `// ${fileName}
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    open: true
  }
});`,
        'json': `{
  "name": "my-project",
  "version": "1.0.0",
  "description": "A sample project",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0"
  }
}`,
        'md': `# ${fileName.replace('.md', '')}

## Getting Started

This is a sample markdown file.

### Features

- Fast and lightweight
- Easy to use
- Great documentation

> For more information, visit the project website.`,
        'txt': `This is a plain text file.

Lorem ipsum dolor sit amet, consectetur
adipiscing elit. Sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua.

Ut enim ad minim veniam, quis nostrud
exercitation ullamco laboris nisi ut
aliquip ex ea commodo consequat.`,
        'css': `/* ${fileName} */
:root {
  --bg-primary: #1e1e1e;
  --text-primary: #d4d4d4;
  --border-color: #3c3c3c;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, sans-serif;
}`,
        'html': `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${fileName.replace('.html', '')}</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>`,
    };

    return contents[ext] || `// ${fileName}\n// File content (prototype)\n// Path: ${filePath}\n\n[模拟文件内容]`;
}

/**
 * 创建浏览器面板的 DOM 容器（不插入到 DOM，由调用方处理）
 * @param {boolean} hideOthers - 是否隐藏其他面板
 * @returns {{panelId: string, container: HTMLElement}|null} 面板 ID 和容器元素
 */
function createBrowserPanelElement(hideOthers = false) {
    const panelsContainer = document.getElementById('panels-container');
    console.log('[浏览器面板] 开始创建浏览器面板');

    if (!panelsContainer) {
        console.error('[浏览器面板] 面板容器不存在!');
        return null;
    }

    panelsContainer.classList.add('flex');
    panelsContainer.classList.remove('items-center', 'justify-center', 'grid');

    const emptyStateEl = panelsContainer.querySelector('div.flex-1.flex.items-center.justify-center.text-gray-500');
    if (emptyStateEl) emptyStateEl.remove();

    if (hideOthers) {
        const existingContainers = document.querySelectorAll('.terminal-container');
        existingContainers.forEach(c => c.style.display = 'none');
    }

    const panelId = `browser-${Date.now()}`;

    // 创建浏览器面板容器
    const container = document.createElement('div');
    container.id = `${panelId}-container`;
    container.className = 'terminal-container flex flex-col browser-panel-container';
    container.setAttribute('data-panel-type', 'browser');
    container.style.cssText = 'display: flex; flex-direction: column; height: 100%; background: var(--bg-primary);';

    container.innerHTML = `
        <div class="panel-header" style="background-color: var(--bg-toolbar); border-bottom-color: var(--border-color); color: var(--text-primary); display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; cursor: grab; user-select: none;">
            <div class="flex items-center gap-2" style="cursor: grab;">
                <svg class="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
                <span class="font-medium" style="color: var(--text-primary);" id="${panelId}-title">新标签页</span>
            </div>
            <div class="panel-controls">
                <button class="panel-btn" onclick="closeBrowserPanel('${panelId}')" style="background: none; border: none; color: var(--text-primary); cursor: pointer; padding: 2px 8px; border-radius: 3px;">关闭</button>
            </div>
        </div>
        <div class="browser-nav" id="${panelId}-nav">
            <!-- 导航按钮组 -->
            <div class="browser-nav-buttons">
                <!-- 后退按钮 -->
                <button class="browser-nav-btn browser-nav-btn-back" id="${panelId}-back-btn" disabled title="后退">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                </button>
                <!-- 前进按钮 -->
                <button class="browser-nav-btn browser-nav-btn-forward" id="${panelId}-forward-btn" disabled title="前进">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
                    </svg>
                </button>
                <!-- 停止按钮（加载时显示） -->
                <button class="browser-nav-btn browser-nav-btn-stop" id="${panelId}-stop-btn" title="停止">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h12v12H6z"/>
                    </svg>
                </button>
                <!-- 刷新按钮（默认显示） -->
                <button class="browser-nav-btn browser-nav-btn-refresh" id="${panelId}-refresh-btn" title="刷新">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                </button>
            </div>
            <!-- 地址栏 -->
            <div class="browser-address-bar-wrapper">
                <input
                    type="text"
                    class="browser-address-bar"
                    id="${panelId}-address-bar"
                    placeholder="输入 URL 或搜索内容..."
                    autocomplete="off"
                    spellcheck="false"
                />
                <!-- 地球图标 -->
                <svg class="browser-address-bar-icon" id="${panelId}-address-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
                <!-- 清除按钮 -->
                <button class="browser-address-bar-clear" id="${panelId}-address-clear" title="清除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="browser-content" id="${panelId}-content">
            <!-- 加载进度条 -->
            <div class="browser-progress-bar-container">
                <div class="browser-progress-bar" id="${panelId}-progress"></div>
            </div>
            <!-- 空白状态 -->
            <div class="browser-empty" id="${panelId}-empty">
                <svg class="browser-empty-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
                <div class="browser-empty-title">浏览器面板</div>
                <div class="browser-empty-desc">
                    在上方地址栏输入 URL 即可加载网页内容。<br/>
                    可以与终端面板并排，方便开发调试。
                </div>
                <div class="browser-empty-hint">快捷输入: example.com / github.com / localhost:5173</div>
            </div>
            <!-- 模拟网页内容（iframe 占位） -->
            <iframe class="browser-webview" id="${panelId}-webview" style="display: none;" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
            <!-- 错误状态 -->
            <div class="browser-error" id="${panelId}-error">
                <svg class="browser-error-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <div class="browser-error-title">无法访问此网站</div>
                <div class="browser-error-message">连接超时或网站拒绝连接。请检查网络连接和 URL 是否正确。</div>
                <div class="browser-error-url"></div>
                <button class="browser-error-retry">重新加载</button>
            </div>
        </div>
    `;

    // 绑定面板点击聚焦事件
    container.addEventListener('click', (e) => {
        if (!e.target.closest('.panel-btn') && !e.target.closest('.browser-nav-btn')) {
            document.querySelectorAll('.terminal-container').forEach(c => c.classList.remove('focused'));
            container.classList.add('focused');
        }
    });

    console.log('[浏览器面板] 已创建浏览器面板容器:', panelId);
    return { panelId, container };
}

/**
 * 关闭浏览器面板
 * @param {string} panelId - 浏览器面板 ID
 */
function closeBrowserPanel(panelId) {
    console.log('[浏览器面板] 关闭面板:', panelId);
    const container = document.getElementById(`${panelId}-container`);
    if (container) {
        // 清理浏览器面板状态
        if (browserPanelState[panelId]) {
            clearTimeout(browserPanelState[panelId].loadTimer);
            clearInterval(browserPanelState[panelId].progressTimer);
            delete browserPanelState[panelId];
        }
        // 复用终端面板的 closePanel 逻辑
        closePanel(container);
    }
}

/**
 * 浏览器面板状态管理（按 panelId 存储）
 * browserPanelState = {
 *   'browser-xxx': {
 *     currentUrl: '',
 *     history: [],
 *     historyIndex: -1,
 *     isLoading: false,
 *     pageTitle: '',
 *     loadTimer: null,
 *     progressTimer: null
 *   }
 * }
 */
const browserPanelState = {};

/**
 * 初始化浏览器面板交互
 * @param {string} panelId - 浏览器面板 ID
 */
function initBrowserPanel(panelId) {
    console.log('[浏览器面板] 初始化交互:', panelId);

    // 初始化状态
    browserPanelState[panelId] = {
        currentUrl: '',
        history: [],
        historyIndex: -1,
        isLoading: false,
        pageTitle: ''
    };

    const dom = {
        nav: document.getElementById(`${panelId}-nav`),
        addressBar: document.getElementById(`${panelId}-address-bar`),
        addressIcon: document.getElementById(`${panelId}-address-icon`),
        addressClear: document.getElementById(`${panelId}-address-clear`),
        backBtn: document.getElementById(`${panelId}-back-btn`),
        forwardBtn: document.getElementById(`${panelId}-forward-btn`),
        stopBtn: document.getElementById(`${panelId}-stop-btn`),
        refreshBtn: document.getElementById(`${panelId}-refresh-btn`),
        progress: document.getElementById(`${panelId}-progress`),
        empty: document.getElementById(`${panelId}-empty`),
        webview: document.getElementById(`${panelId}-webview`),
        error: document.getElementById(`${panelId}-error`),
        title: document.getElementById(`${panelId}-title`),
        errorUrl: document.querySelector(`#${panelId}-error .browser-error-url`),
        errorRetry: document.querySelector(`#${panelId}-error .browser-error-retry`)
    };

    // 预设 URL 映射
    const urlMap = {
        'https://example.com': {
            title: 'Example Domain',
            content: '<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;color:#333;line-height:1.6}h1{color:#1a1a1a;font-size:28px;margin-bottom:16px}p{margin:12px 0}a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}.tag{display:inline-block;background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:13px;color:#666;margin-top:8px}</style></head><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.</p><p><a href="https://www.iana.org/domains/example">More information...</a></p><span class="tag">Nexus 浏览器面板 - 模拟页面</span></body></html>'
        },
        'https://github.com': {
            title: 'GitHub: Let\'s build from here',
            content: '<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#0d1117;color:#c9d1d9;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px}.logo{font-size:48px;margin-bottom:16px}h1{font-size:32px;color:#f0f6fc;margin:0 0 8px}p{color:#8b949e;font-size:16px;margin:0 0 24px}.btn{background:#238636;color:#fff;padding:8px 16px;border-radius:6px;border:none;font-size:14px;cursor:pointer}.tag{display:inline-block;background:#21262d;padding:2px 8px;border-radius:4px;font-size:12px;color:#8b949e;margin-top:16px;border:1px solid #30363d}</style></head><body><div class="logo">🐙</div><h1>GitHub</h1><p>Where the world builds software</p><button class="btn">Sign up</button><span class="tag">Nexus 浏览器面板 - 模拟页面</span></body></html>'
        },
        'http://localhost:5173': {
            title: 'Vite App - localhost:5173',
            content: '<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;margin:0}h1{background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:36px;margin:0 0 8px}.vite{color:#646cff;font-weight:bold}.tag{background:#16213e;padding:4px 12px;border-radius:6px;font-size:12px;color:#888;margin-top:16px;border:1px solid #1f4068}</style></head><body><h1><span class="vite">Vite</span> + React</h1><p style="color:#aaa">Development server running at localhost:5173</p><p style="color:#666;font-size:13px;margin-top:4px">Edit src/App.jsx and save to test HMR</p><span class="tag">Nexus 浏览器面板 - 模拟页面</span></body></html>'
        }
    };

    /**
     * 规范化 URL
     */
    function normalizeUrl(input) {
        let url = input.trim();
        if (!url) return '';
        if (/^(localhost|[\d.]+)(:\d+)?$/.test(url) || url.startsWith('localhost')) {
            return 'http://' + url;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return 'https://' + url;
        }
        return url;
    }

    /**
     * 更新导航按钮状态
     */
    function updateNavButtons() {
        const state = browserPanelState[panelId];
        dom.backBtn.disabled = state.historyIndex <= 0;
        dom.forwardBtn.disabled = state.historyIndex >= state.history.length - 1;
    }

    /**
     * 显示错误状态
     */
    function showError(url) {
        const state = browserPanelState[panelId];
        state.isLoading = false;
        dom.nav.classList.remove('loading');
        dom.progress.style.width = '0%';

        dom.empty.style.display = 'none';
        dom.webview.style.display = 'none';
        dom.error.classList.add('show');

        if (dom.errorUrl) dom.errorUrl.textContent = url;
        dom.title.textContent = '无法访问此网站';
        dom.addressIcon.style.color = 'var(--error-text, #f87171)';
        updateNavButtons();
    }

    /**
     * 完成加载
     */
    function finishLoading(url) {
        const state = browserPanelState[panelId];
        state.isLoading = false;
        clearInterval(state.progressTimer);
        dom.progress.style.width = '100%';

        setTimeout(() => {
            dom.progress.style.width = '0%';
            dom.nav.classList.remove('loading');
            updateNavButtons();

            const pageData = urlMap[url];
            if (pageData) {
                // 预设的模拟页面
                state.pageTitle = pageData.title;
                dom.webview.srcdoc = pageData.content;
                dom.webview.style.display = 'block';
                dom.empty.style.display = 'none';
                dom.error.classList.remove('show');
                dom.title.textContent = pageData.title;
                dom.addressIcon.innerHTML = '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>';
                dom.addressIcon.style.color = '';
            } else {
                // 尝试通过 iframe src 加载外部 URL
                dom.webview.removeAttribute('srcdoc');
                dom.webview.src = url;
                dom.webview.style.display = 'block';
                dom.empty.style.display = 'none';
                dom.error.classList.remove('show');

                // 从 URL 提取标题
                try {
                    const urlObj = new URL(url);
                    state.pageTitle = urlObj.hostname;
                } catch {
                    state.pageTitle = url;
                }
                dom.title.textContent = state.pageTitle;
                dom.addressIcon.innerHTML = '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>';
                dom.addressIcon.style.color = '';
            }
        }, 300);
    }

    /**
     * 开始加载
     */
    function startLoading(url) {
        if (!url) return;
        const state = browserPanelState[panelId];
        const normalized = normalizeUrl(url);
        if (!normalized) return;

        // 添加到历史记录
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(normalized);
        state.historyIndex = state.history.length - 1;
        state.currentUrl = normalized;

        dom.addressBar.value = normalized;
        state.isLoading = true;
        dom.nav.classList.add('loading');
        updateNavButtons();
        dom.empty.style.display = 'none';
        dom.webview.style.display = 'none';
        dom.error.classList.remove('show');
        dom.title.textContent = '加载中...';

        let progress = 0;
        dom.progress.style.width = '0%';
        clearInterval(state.progressTimer);
        state.progressTimer = setInterval(() => {
            progress += Math.random() * 15 + 5;
            if (progress > 92) progress = 92;
            dom.progress.style.width = progress + '%';
        }, 200);

        clearTimeout(state.loadTimer);
        state.loadTimer = setTimeout(() => {
            finishLoading(normalized);
        }, 2000);
    }

    /**
     * 停止加载
     */
    function stopLoading() {
        const state = browserPanelState[panelId];
        state.isLoading = false;
        clearTimeout(state.loadTimer);
        clearInterval(state.progressTimer);
        dom.nav.classList.remove('loading');
        dom.progress.style.width = '0%';
        updateNavButtons();
        // 回到空白状态
        dom.empty.style.display = 'flex';
        dom.webview.style.display = 'none';
        dom.error.classList.remove('show');
        dom.title.textContent = '新标签页';
    }

    // 地址栏回车
    dom.addressBar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            startLoading(dom.addressBar.value);
            dom.addressBar.blur();
        }
    });

    // 地址栏聚焦时全选文本
    dom.addressBar.addEventListener('focus', () => {
        dom.addressBar.select();
    });

    // 清除按钮
    dom.addressClear.addEventListener('click', () => {
        dom.addressBar.value = '';
        dom.addressBar.focus();
    });

    // 后退
    dom.backBtn.addEventListener('click', () => {
        const state = browserPanelState[panelId];
        if (state.historyIndex > 0) {
            state.historyIndex--;
            const url = state.history[state.historyIndex];
            state.currentUrl = url;
            dom.addressBar.value = url;
            // 重新加载
            state.isLoading = true;
            dom.nav.classList.add('loading');
            updateNavButtons();
            dom.empty.style.display = 'none';
            dom.webview.style.display = 'none';
            dom.error.classList.remove('show');
            dom.title.textContent = '加载中...';
            finishLoading(url);
        }
    });

    // 前进
    dom.forwardBtn.addEventListener('click', () => {
        const state = browserPanelState[panelId];
        if (state.historyIndex < state.history.length - 1) {
            state.historyIndex++;
            const url = state.history[state.historyIndex];
            state.currentUrl = url;
            dom.addressBar.value = url;
            state.isLoading = true;
            dom.nav.classList.add('loading');
            updateNavButtons();
            dom.empty.style.display = 'none';
            dom.webview.style.display = 'none';
            dom.error.classList.remove('show');
            dom.title.textContent = '加载中...';
            finishLoading(url);
        }
    });

    // 刷新
    dom.refreshBtn.addEventListener('click', () => {
        const state = browserPanelState[panelId];
        if (state.currentUrl) {
            startLoading(state.currentUrl);
        }
    });

    // 停止
    dom.stopBtn.addEventListener('click', () => {
        stopLoading();
    });

    // 错误重试
    if (dom.errorRetry) {
        dom.errorRetry.addEventListener('click', () => {
            const state = browserPanelState[panelId];
            if (state.currentUrl) {
                startLoading(state.currentUrl);
            }
        });
    }

    updateNavButtons();
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 模拟文件列表数据（原型阶段使用，后续替换为 Electron API）
 * @param {string} path - 当前目录路径
 * @returns {Array} 文件/文件夹列表
 */
function mockFileList(path) {
    // 根据路径返回不同的模拟数据
    if (path.includes('projects') || path === '~/projects') {
        return [
            { name: 'Nexus', type: 'folder', size: '-', modified: '2026-04-10' },
            { name: 'my-website', type: 'folder', size: '-', modified: '2026-04-08' },
            { name: 'node-app', type: 'folder', size: '-', modified: '2026-04-05' },
            { name: 'README.md', type: 'file', size: '2.3 KB', modified: '2026-04-10' },
            { name: 'package.json', type: 'file', size: '1.1 KB', modified: '2026-04-08' },
            { name: '.gitignore', type: 'file', size: '0.2 KB', modified: '2026-04-01' },
        ];
    }
    // 默认返回模拟数据
    return [
        { name: 'Documents', type: 'folder', size: '-', modified: '2026-04-09' },
        { name: 'Downloads', type: 'folder', size: '-', modified: '2026-04-10' },
        { name: 'Desktop', type: 'folder', size: '-', modified: '2026-04-08' },
        { name: 'notes.txt', type: 'file', size: '4.5 KB', modified: '2026-04-10' },
        { name: 'photo.jpg', type: 'file', size: '1.2 MB', modified: '2026-04-07' },
    ];
}

/**
 * 渲染文件列表到文件网格
 * @param {string} panelId - 文件面板 ID
 * @param {string} rootPath - 根目录路径
 * @param {string} currentPath - 当前目录路径
 */
function renderFileList(panelId, rootPath, currentPath) {
    const container = document.getElementById(`${panelId}-container`);
    if (!container) return;

    const grid = container.querySelector('.file-grid');
    if (!grid) return;

    // 渲染面包屑导航（从 rootPath 到 currentPath 的完整路径）
    const breadcrumb = container.querySelector('.file-breadcrumb');
    if (breadcrumb && currentPath) {
        // 解析路径，生成面包屑片段
        const pathSegments = currentPath.split('/').filter(Boolean);
        const breadcrumbHTML = pathSegments.map((seg, index) => {
            const partialPath = '/' + pathSegments.slice(0, index + 1).join('/');
            const isLast = index === pathSegments.length - 1;
            if (isLast) {
                return `<span class="breadcrumb-segment" style="color: var(--accent); cursor: default; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${seg}</span>`;
            }
            return `<span class="breadcrumb-segment" style="color: var(--text-primary); cursor: pointer; padding: 2px 4px; border-radius: 3px;" data-nav-path="${partialPath}">${seg}</span>`;
        }).join('<span style="color: var(--text-muted);">/</span>');
        breadcrumb.innerHTML = breadcrumbHTML;

        // 绑定面包屑点击导航
        breadcrumb.querySelectorAll('.breadcrumb-segment[style*="cursor: pointer"]').forEach(seg => {
            seg.addEventListener('click', (e) => {
                const navPath = seg.getAttribute('data-nav-path');
                if (navPath) {
                    renderFileList(panelId, rootPath, navPath);
                }
            });
        });
    }

    const files = mockFileList(currentPath || rootPath);
    // 文件夹在前，文件在后
    const sorted = [...files].sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
    });

    // 在列表最前面添加上级目录（如果当前路径还有上级可跳）
    let htmlParts = [];
    const pathParts = (currentPath || '').split(/[\/\\]/).filter(Boolean);
    if (pathParts.length > 1) {
        const parentPath = pathParts.length <= 2 ? '/' + pathParts[0] : '/' + pathParts.slice(0, -1).join('/');
        htmlParts.push(
            `<div class="file-item" data-name=".." data-type="parent-dir" data-path="${parentPath}"
                 style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 90px; height: 90px; border-radius: 6px; cursor: pointer; padding: 8px; transition: background-color 0.2s;"
                 onmouseover="this.style.backgroundColor='rgba(59,130,246,0.1)'"
                 onmouseout="this.style.backgroundColor=''">
                <div style="font-size: 32px; margin-bottom: 4px;">📂</div>
                <div style="font-size: 12px; text-align: center; color: var(--text-muted); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="返回上级目录">
                    ..
                </div>
            </div>`
        );
    }

    // 添加文件列表
    sorted.forEach(f => {
        htmlParts.push(
            `<div class="file-item" data-name="${f.name}" data-type="${f.type}" data-path="${currentPath || rootPath}"
                 style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 90px; height: 90px; border-radius: 6px; cursor: pointer; padding: 8px; transition: background-color 0.2s;"
                 onmouseover="this.style.backgroundColor='rgba(59,130,246,0.1)'"
                 onmouseout="this.style.backgroundColor=''">
                <div style="font-size: 32px; margin-bottom: 4px;">
                    ${f.type === 'folder' ? '📁' : '📄'}
                </div>
                <div style="font-size: 12px; text-align: center; color: var(--text-primary); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${f.name}">
                    ${f.name}
                </div>
            </div>`
        );
    });

    grid.innerHTML = htmlParts.join('');

    // 绑定文件夹双击事件
    grid.querySelectorAll('.file-item').forEach(item => {
        const itemType = item.dataset.type;

        // 上级目录双击
        if (itemType === 'parent-dir') {
            item.addEventListener('dblclick', () => {
                renderFileList(panelId, rootPath, item.dataset.path);
            });
            return;
        }

        // 子文件夹双击进入
        if (itemType === 'folder') {
            item.addEventListener('dblclick', () => {
                const newPath = `${item.dataset.path}/${item.dataset.name}`;
                const breadcrumb = container.querySelector('.file-breadcrumb');
                if (breadcrumb) {
                    breadcrumb.setAttribute('data-current-path', newPath);
                }
                renderFileList(panelId, rootPath, newPath);
            });
        }

        // 文件双击打开
        if (itemType === 'file') {
            item.addEventListener('dblclick', () => {
                const filePath = `${item.dataset.path}/${item.dataset.name}`;
                openFile(panelId, filePath, item.dataset.name, rootPath, currentPath);
            });
        }
    });

    console.log('[文件面板] 文件列表已渲染，共', sorted.length, '项');
}

/**
 * 切换面板聚焦状态
 * @param {string} panelId - 要聚焦的面板 ID
 * @param {boolean} force - 是否强制聚焦（即使终端还未准备好）
 */
function focusPanel(panelId, force = false) {
    console.log('[焦点管理] 尝试聚焦面板:', panelId, 'force:', force);

    const activeSession = sessions.find(s => s.status === 'active');

    // 记录上一个聚焦的面板（在切换之前）- 存储在会话中
    if (activeSession && activeSession.focusedPanelId && activeSession.focusedPanelId !== panelId) {
        activeSession.lastFocusedPanelId = activeSession.focusedPanelId;
    }

    // 移除所有面板的聚焦样式 - 使用更通用的选择器
    const focusedPanels = document.querySelectorAll('.terminal-container.panel-focused');
    console.log('[焦点管理] 当前聚焦的面板数量:', focusedPanels.length);
    document.querySelectorAll('.terminal-container').forEach(el => {
        el.classList.remove('panel-focused');
    });
    console.log('[焦点管理] 已移除所有面板的聚焦样式');

    // 更新全局 focusedPanelId（用于兼容）
    focusedPanelId = panelId;

    // 更新会话中的 focusedPanelId 和 activePanelId
    if (activeSession) {
        activeSession.focusedPanelId = panelId;
        activeSession.activePanelId = panelId;
    }

    if (panelId) {
        // 添加聚焦样式 - 使用容器 ID 选择
        const panelContainer = document.getElementById(`${panelId}-container`);
        if (panelContainer) {
            panelContainer.classList.add('panel-focused');
            console.log('[焦点管理] 已添加聚焦样式到容器:', `${panelId}-container`);
            // 检查当前有多少面板有聚焦样式
            const nowFocused = document.querySelectorAll('.terminal-container.panel-focused');
            console.log('[焦点管理] 当前有聚焦样式的面板数量:', nowFocused.length);
        } else {
            console.warn('[焦点管理] 未找到面板容器:', `${panelId}-container`);
        }

        // 聚焦对应终端
        if (terminals[panelId]) {
            console.log('[焦点管理] 终端实例存在，调用 focus()');
            // 使用 setTimeout 确保终端已准备好
            setTimeout(() => {
                terminals[panelId].focus();
                console.log('[焦点管理] 已调用终端 focus()');
            }, 50);
        } else if (force) {
            console.warn('[焦点管理] 终端实例不存在，但 force=true，稍后会重试');
            // 如果终端还没准备好，稍后重试
            setTimeout(() => {
                if (terminals[panelId]) {
                    terminals[panelId].focus();
                    console.log('[焦点管理] 重试 focus() 成功');
                } else {
                    console.error('[焦点管理] 重试 focus() 失败，终端实例仍不存在');
                }
            }, 100);
        } else {
            console.warn('[焦点管理] 终端实例不存在:', panelId);
        }
    } else {
        console.warn('[焦点管理] panelId 为空');
    }
}

/**
 * 处理面板点击事件
 */
function bindPanelEvents() {
    document.querySelectorAll('.terminal-container').forEach((container) => {
        // 如果已经绑定过事件，则跳过
        if (container.dataset.panelEventBound === 'true') {
            console.log('[面板事件] 面板已绑定事件，跳过:', container.id);
            return;
        }

        container.dataset.panelEventBound = 'true';
        console.log('[面板事件] 绑定点击事件到面板:', container.id);

        container.addEventListener('click', (e) => {
            console.log('[面板事件] 面板被点击:', container.id, '目标元素:', e.target.tagName, e.target.className);

            if (e.target.classList.contains('panel-btn') || e.target.closest('.panel-btn')) {
                console.log('[面板事件] 点击的是按钮，忽略');
                return;
            }

            if (e.target.classList.contains('panel-ai-squirrel') || e.target.closest('.panel-ai-squirrel')) {
                console.log('[面板事件] 点击的是 AI 小松鼠，忽略聚焦，让事件冒泡到 smart-window.js');
                return;
            }

            // 从容器的 ID 获取 panelId (格式：terminal-xxx-container -> terminal-xxx)
            const containerId = container.id;
            const panelId = containerId.replace('-container', '');
            console.log('[面板事件] 获取到 panelId:', panelId);

            // 聚焦面板
            focusPanel(panelId);

            // 选中面板（用于树形分割）
            selectPanel(panelId);
        });

        // 绑定面板头部拖动事件
        bindPanelDragEvents(container);
    });
}

/**
 * 变量用于存储拖动状态
 */
let draggedPanel = null;      // 正在拖动的面板
let dragOverPanel = null;     // 当前拖入的面板
let panelDragEventsBound = false;  // 是否已绑定拖动事件
let dragGhost = null;         // 拖动时的虚影元素
let dragOffsetX = 0;          // 鼠标相对于面板左上角的偏移
let dragOffsetY = 0;

/**
 * 绑定面板头部拖动事件
 * @param {HTMLElement} container - 面板容器
 */
function bindPanelDragEvents(container) {
    const header = container.querySelector('.panel-header');
    if (!header) return;

    // 阻止默认的文本选择
    header.addEventListener('selectstart', (e) => e.preventDefault());

    // 鼠标按下 - 开始拖动
    header.addEventListener('mousedown', (e) => {
        // 如果点击的是按钮，不拖动
        if (e.target.classList.contains('panel-btn') || e.target.closest('.panel-btn')) {
            return;
        }

        const activeSession = sessions.find(s => s.status === 'active');
        if (!activeSession || !activeSession.panelIds || activeSession.panelIds.length <= 1) {
            console.log('[面板拖动] 只有一个面板，不可拖动');
            return;
        }

        draggedPanel = container;
        console.log('[面板拖动] 开始拖动:', container.id);

        // 计算鼠标相对于面板的偏移
        const rect = container.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        // 创建虚影元素
        dragGhost = container.cloneNode(true);
        dragGhost.classList.add('drag-ghost');
        dragGhost.style.position = 'fixed';
        dragGhost.style.left = rect.left + 'px';
        dragGhost.style.top = rect.top + 'px';
        dragGhost.style.width = rect.width + 'px';
        dragGhost.style.height = rect.height + 'px';
        dragGhost.style.opacity = '0.7';
        dragGhost.style.pointerEvents = 'none';
        dragGhost.style.zIndex = '9999';
        document.body.appendChild(dragGhost);

        // 原面板半透明
        container.style.opacity = '0.3';
    });

    // 全局鼠标移动和释放事件只绑定一次
    if (!panelDragEventsBound) {
        panelDragEventsBound = true;

        // 鼠标移动 - 拖动中
        document.addEventListener('mousemove', (e) => {
            if (!draggedPanel) return;

            // 移动虚影元素跟随鼠标
            if (dragGhost) {
                dragGhost.style.left = (e.clientX - dragOffsetX) + 'px';
                dragGhost.style.top = (e.clientY - dragOffsetY) + 'px';
            }

            // 隐藏原面板，避免干扰
            draggedPanel.style.visibility = 'hidden';

            // 查找当前鼠标位置下的面板（排除虚影和原面板）
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const targetPanel = elements.find(el =>
                el.classList.contains('terminal-container') &&
                el !== draggedPanel &&
                !el.classList.contains('drag-ghost')
            );

            // 清除之前的拖入样式
            if (dragOverPanel && dragOverPanel !== draggedPanel) {
                dragOverPanel.classList.remove('drag-over');
            }

            if (targetPanel) {
                dragOverPanel = targetPanel;
                // 添加拖入提示样式
                targetPanel.classList.add('drag-over');
                console.log('[面板拖动] 拖入目标:', targetPanel.id);
            } else {
                dragOverPanel = null;
            }
        });

        // 鼠标释放 - 结束拖动
        document.addEventListener('mouseup', (e) => {
            if (!draggedPanel) return;

            console.log('[面板拖动] 结束拖动:', draggedPanel.id, '目标:', dragOverPanel?.id);

            // 如果有有效的拖入目标，交换位置
            if (dragOverPanel && dragOverPanel !== draggedPanel) {
                swapPanels(draggedPanel, dragOverPanel);
            }

            // 清除拖动状态
            if (draggedPanel) {
                draggedPanel.style.opacity = '';
                draggedPanel.style.visibility = '';
            }

            if (dragOverPanel) {
                dragOverPanel.classList.remove('drag-over');
            }

            // 移除虚影元素
            if (dragGhost) {
                dragGhost.remove();
                dragGhost = null;
            }

            draggedPanel = null;
            dragOverPanel = null;
        });
    }
}

/**
 * 统计布局树中的面板数量
 * @param {Object} node - 当前节点
 * @returns {number} 面板数量
 */
function countPanelsInTree(node) {
    if (!node) return 0;
    if (node.type === 'panel') return 1;
    if (!node.children) return 0;

    return node.children.reduce((sum, child) => sum + countPanelsInTree(child), 0);
}

/**
 * 交换两个面板的位置
 * @param {HTMLElement} panel1 - 第一个面板容器
 * @param {HTMLElement} panel2 - 第二个面板容器
 */
function swapPanels(panel1, panel2) {
    console.log('[面板拖动] 交换面板:', panel1.id, '<->', panel2.id);

    const activeSession = sessions.find(s => s.status === 'active');
    if (!activeSession) return;

    // 从面板 ID 获取真实的面板 ID
    const panel1Id = panel1.id.replace('-container', '');
    const panel2Id = panel2.id.replace('-container', '');

    const beforeCount = countPanelsInTree(activeSession.layout);
    console.log('[面板拖动] 交换前面板数量:', beforeCount);
    console.log('[面板拖动] 交换前布局树:', JSON.stringify(activeSession.layout, null, 2));

    // 获取两个面板在布局树中的路径
    const path1 = findNodePath(activeSession.layout, panel1Id);
    const path2 = findNodePath(activeSession.layout, panel2Id);

    console.log('[面板拖动] 面板 1 路径:', path1, '面板 2 路径:', path2);

    if (path1 && path2) {
        // 交换布局树中的节点
        swapNodesInTree(activeSession.layout, panel1Id, panel2Id);

        // 简化树结构（移除只有一个子节点的容器）
        activeSession.layout = simplifyTree(activeSession.layout);

        const afterCount = countPanelsInTree(activeSession.layout);
        console.log('[面板拖动] 交换后面板数量:', afterCount);
        console.log('[面板拖动] 交换后布局树:', JSON.stringify(activeSession.layout, null, 2));

        if (afterCount !== beforeCount) {
            console.error('[面板拖动] 错误：交换后面板数量不一致！', beforeCount, '->', afterCount);
        }

        // 重新渲染布局
        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            const panelRefs = new Map();
            panelsContainer.querySelectorAll('.terminal-container').forEach(el => {
                const id = el.id.replace('-container', '');
                panelRefs.set(id, el);
            });

            panelsContainer.innerHTML = '';
            renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);

            // 重新绑定事件到新渲染的面板
            bindPanelEvents();
        }
    } else {
        console.log('[面板拖动] 未找到面板在布局树中的路径');
    }
}

/**
 * 在布局树中查找节点的路径
 * @param {Object} node - 当前节点
 * @param {string} targetId - 目标面板 ID
 * @param {Array} path - 当前路径
 * @returns {Array} 路径数组
 */
function findNodePath(node, targetId, path = []) {
    if (!node) return null;

    if (node.type === 'panel' && node.id === targetId) {
        return path;
    }

    if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            const newPath = [...path, i];
            const result = findNodePath(child, targetId, newPath);
            if (result) return result;
        }
    }

    return null;
}

/**
 * 在布局树中替换指定节点（用于交换）
 * @param {Object} node - 当前节点
 * @param {string} targetId - 目标面板 ID
 * @param {Object} newNode - 新节点
 * @returns {boolean} 是否找到并替换
 */
function replacePanelNodeInTree(node, targetId, newNode) {
    if (!node || node.type === 'panel') return false;

    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'panel' && child.id === targetId) {
            node.children[i] = newNode;
            return true;
        }
        if (child.children && child.children.length > 0) {
            if (replacePanelNodeInTree(child, targetId, newNode)) return true;
        }
    }

    return false;
}

/**
 * 交换布局树中的两个节点
 * @param {Object} node - 当前节点
 * @param {string} id1 - 第一个面板 ID
 * @param {string} id2 - 第二个面板 ID
 * @param {Array} basePath - 当前节点在整棵树中的路径（用于跨层级交换）
 */
function swapNodesInTree(node, id1, id2, basePath = []) {
    if (!node) return false;

    // 如果当前节点是面板，直接返回
    if (node.type === 'panel') return false;

    // 查找两个节点在子节点数组中的位置
    const index1 = node.children.findIndex(child => child.type === 'panel' && child.id === id1);
    const index2 = node.children.findIndex(child => child.type === 'panel' && child.id === id2);

    if (index1 !== -1 && index2 !== -1) {
        // 两个节点都在当前层级，直接交换
        console.log('[面板拖动] 在同一层级交换:', index1, '<->', index2);
        [node.children[index1], node.children[index2]] = [node.children[index2], node.children[index1]];
        return true;
    }

    // 只有一个节点在当前层级，需要递归查找
    if (index1 !== -1 || index2 !== -1) {
        // 找到在当前层级的节点索引和 ID
        const currentIndex = index1 !== -1 ? index1 : index2;
        const currentId = index1 !== -1 ? id1 : id2;
        const targetId = index1 !== -1 ? id2 : id1;

        console.log('[面板拖动] 一个节点在当前层级， currentIndex:', currentIndex, 'currentId:', currentId, 'targetId:', targetId);

        // 在子节点中递归查找目标节点
        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            if (child.children && child.children.length > 0) {
                // 计算子节点在整棵树中的路径
                const childPath = [...basePath, i];
                const foundPath = findNodePath(child, targetId);

                if (foundPath !== null) {
                    console.log('[面板拖动] 找到目标节点，完整路径:', [...childPath, ...foundPath], '子路径:', foundPath);

                    // 1. 创建当前节点的新副本
                    const currentNewNode = { type: 'panel', id: currentId };
                    // 2. 在子树中替换目标节点为当前节点（保留其他子节点）
                    replacePanelNodeInTree(child, targetId, currentNewNode);
                    // 3. 简化子树
                    node.children[i] = simplifyTree(child);
                    // 4. 替换当前层级的节点为目标节点
                    node.children[currentIndex] = { type: 'panel', id: targetId };
                    console.log('[面板拖动] 跨层级交换:', currentId, '<->', targetId);
                    return true;
                }
            }
        }
        return false;
    }

    // 两个节点都不在当前层级，需要分别查找它们所在的子树
    console.log('[面板拖动] 两个节点都不在当前层级，递归查找');

    let sourceTreeIndex = -1;
    let sourceTree = null;
    let targetTreeIndex = -1;
    let targetTree = null;

    // 查找两个节点分别在哪个子树中
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.children && child.children.length > 0) {
            if (findNodePath(child, id1) !== null) {
                sourceTreeIndex = i;
                sourceTree = child;
            }
            if (findNodePath(child, id2) !== null) {
                targetTreeIndex = i;
                targetTree = child;
            }
        }
    }

    console.log('[面板拖动] sourceTreeIndex:', sourceTreeIndex, 'targetTreeIndex:', targetTreeIndex);

    // 如果两个节点在不同的子树中
    if (sourceTreeIndex !== -1 && targetTreeIndex !== -1 && sourceTreeIndex !== targetTreeIndex) {
        console.log('[面板拖动] 两个节点在不同子树，交换子树节点');

        // 从 sourceTree 中提取 id1 节点
        const sourceNode = extractPanelNodeFromTree(sourceTree, id1);
        // 从 targetTree 中提取 id2 节点
        const targetNode = extractPanelNodeFromTree(targetTree, id2);

        if (sourceNode && targetNode) {
            // 在 sourceTree 中插入 targetNode
            replacePanelNodeInTree(sourceTree, id1, targetNode);
            // 在 targetTree 中插入 sourceNode
            replacePanelNodeInTree(targetTree, id2, sourceNode);

            // 简化子树
            node.children[sourceTreeIndex] = simplifyTree(sourceTree);
            node.children[targetTreeIndex] = simplifyTree(targetTree);

            console.log('[面板拖动] 跨子树交换完成:', id1, '<->', id2);
            return true;
        }
    }

    // 两个节点在同一个子树中，递归查找
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.children && child.children.length > 0) {
            if (swapNodesInTree(child, id1, id2, [...basePath, i])) return true;
        }
    }

    return false;
}

/**
 * 从树中提取指定节点（用于交换）
 * @param {Object} node - 当前节点
 * @param {string} targetId - 目标面板 ID
 * @returns {Object} 提取的节点
 */
function extractPanelNodeFromTree(node, targetId) {
    if (!node || node.type === 'panel') return null;

    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'panel' && child.id === targetId) {
            return node.children[i];
        }
        if (child.children && child.children.length > 0) {
            const result = extractPanelNodeFromTree(child, targetId);
            if (result) return result;
        }
    }

    return null;
}

/**
 * 简化布局树（移除只有一个子节点的容器节点）
 * @param {Object} node - 当前节点
 * @returns {Object} 简化后的节点
 */
function simplifyTree(node) {
    if (!node || node.type === 'panel') return node;

    // 递归简化子节点
    if (node.children) {
        node.children = node.children.map(child => simplifyTree(child)).filter(c => c !== null);
    }

    // 如果容器只有一个子节点，返回子节点（提升一层）
    if (node.children && node.children.length === 1) {
        return node.children[0];
    }

    return node;
}

/**
 * 选中/取消选中面板
 * @param {string} panelId - 面板 ID
 */
function selectPanel(panelId) {
    const activeSession = sessions.find(s => s.status === 'active');
    const currentSelectedPanelId = activeSession ? activeSession.selectedPanelId : selectedPanelId;

    console.log('[选中管理] 尝试选中面板:', panelId, '当前 selectedPanelId:', currentSelectedPanelId);

    // 移除所有选中状态
    document.querySelectorAll('.terminal-container.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // 如果点击的是已选中的面板，取消选中
    if (currentSelectedPanelId === panelId) {
        console.log('[选中管理] 取消选中:', panelId);
        if (activeSession) {
            activeSession.selectedPanelId = null;
        } else {
            selectedPanelId = null;
        }
        updateLayoutSelectorState();
        return;
    }

    // 选中新的面板
    if (activeSession) {
        activeSession.selectedPanelId = panelId;
    } else {
        selectedPanelId = panelId;
    }

    const panelContainer = document.getElementById(`${panelId}-container`);
    if (panelContainer) {
        panelContainer.classList.add('selected');
        console.log('[选中管理] 已选中面板:', panelId);
    }

    // 更新布局选择器状态
    updateLayoutSelectorState();
}

/**
 * 从右键菜单关闭面板
 * 关闭右键点击的面板
 */
function closePanelFromMenu() {
    if (!rightClickedPanelId) {
        console.log('[面板管理] 没有右键点击的面板，无法关闭');
        return;
    }

    // 使用容器 ID 选择面板（格式：terminal-xxx-container）
    const containerId = rightClickedPanelId + '-container';
    const panel = document.getElementById(containerId);

    if (!panel) {
        console.log('[面板管理] 未找到面板容器:', containerId);
        return;
    }

    console.log('[面板管理] 从右键菜单关闭面板:', containerId);

    // 先关闭右键菜单
    hideContextMenu();

    closePanel(panel);
}

/**
 * 从标题栏关闭按钮关闭面板
 * @param {HTMLElement} btn - 关闭按钮元素
 */
function closePanelFromHeader(btn) {
    const panel = btn.closest('.terminal-container');
    if (!panel) {
        return;
    }

    closePanel(panel);
}

/**
 * 关闭面板的核心逻辑
 * @param {HTMLElement} panel - 要关闭的面板元素
 */
function closePanel(panel) {
    // 从容器 ID 获取正确的 panelId (格式：terminal-xxx-container -> terminal-xxx)
    const containerId = panel.id;
    const panelId = containerId.replace('-container', '');

    console.log('[面板管理] 关闭面板：containerId =', containerId, 'panelId =', panelId);

    // 使用模态窗口确认（与删除会话一致）
    showConfirmModal(
        '确定要关闭此面板吗？',
        '关闭面板会终止该面板运行的终端进程。',
        function() {
            // 清理终端实例
            if (terminals[panelId]) {
                terminals[panelId].dispose();
                delete terminals[panelId];
            }

            // 从布局树移除面板（树形布局）
            const activeSession = sessions.find(s => s.status === 'active');
            if (activeSession) {
                // 从布局树移除并简化
                if (activeSession.layout) {
                    activeSession.layout = removeNodeFromTree(activeSession.layout, panelId);
                }

                // 从 panelIds 数组移除（向后兼容）
                let newFocusPanelId = null;
                if (activeSession.panelIds) {
                    const panelIndex = activeSession.panelIds.indexOf(panelId);
                    activeSession.panelIds = activeSession.panelIds.filter(id => id !== panelId);

                    // 如果关闭的是当前激活的面板，智能选择下一个焦点面板
                    if (activeSession.activePanelId === panelId) {
                        // 优先选择上一个聚焦的面板（如果还存在）
                        if (activeSession.lastFocusedPanelId && activeSession.panelIds.includes(activeSession.lastFocusedPanelId)) {
                            newFocusPanelId = activeSession.lastFocusedPanelId;
                            console.log('[面板管理] 焦点转移到上一个聚焦的面板:', activeSession.lastFocusedPanelId);
                        } else if (panelIndex < activeSession.panelIds.length) {
                            newFocusPanelId = activeSession.panelIds[panelIndex]; // 下一个面板
                        } else if (panelIndex > 0) {
                            newFocusPanelId = activeSession.panelIds[panelIndex - 1]; // 上一个面板
                        } else {
                            newFocusPanelId = null; // 没有剩余面板
                        }
                        activeSession.activePanelId = newFocusPanelId;
                    }

                    console.log('[面板管理] 已从会话移除面板:', panelId, '剩余面板:', activeSession.panelIds, '新焦点面板:', newFocusPanelId);
                }

                // 如果没有面板了，删除会话
                if (activeSession.panelIds.length === 0) {
                    console.log('[面板管理] 会话已没有面板，删除会话:', activeSession.id);
                    // 从 sessions 数组中删除该会话
                    const sessionIndex = sessions.findIndex(s => s.id === activeSession.id);
                    if (sessionIndex > -1) {
                        sessions.splice(sessionIndex, 1);
                    }

                    // 重置全局变量
                    selectedPanelId = null;
                    focusedPanelId = null;

                    // 清空面板容器
                    const panelsContainer = document.getElementById('panels-container');
                    if (panelsContainer) {
                        panelsContainer.innerHTML = '';
                        panelsContainer.style.display = 'flex';
                        panelsContainer.style.flexDirection = 'row';
                    }

                    // 重新渲染会话列表（会显示"没有会话"的空状态）
                    renderSessionList();
                } else {
                    // 先保存所有剩余面板的引用
                    const panelRefs = new Map();
                    activeSession.panelIds.forEach(id => {
                        const panelEl = document.getElementById(`${id}-container`);
                        if (panelEl) {
                            panelRefs.set(id, panelEl);
                            console.log('[面板管理] 保存面板引用:', id);
                        }
                    });

                    // 重新渲染布局树
                    const panelsContainer = document.getElementById('panels-container');
                    if (panelsContainer && activeSession.layout) {
                        panelsContainer.innerHTML = '';
                        // 使用会话中的 selectedPanelId
                        renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
                    } else if (panelsContainer) {
                        // 向后兼容：没有 layout 时使用旧方式
                        panelsContainer.innerHTML = '';
                        activeSession.panelIds.forEach(id => {
                            const containerEl = document.getElementById(`${id}-container`);
                            if (containerEl) {
                                containerEl.style.display = 'flex';
                                panelsContainer.appendChild(containerEl);
                            }
                        });
                        updateLayoutStyle(activeSession.panelIds.length);
                    }

                    // 更新布局选择器状态
                    updateLayoutSelectorState();

                    // 聚焦到剩余的面板（等待渲染完成）
                    if (newFocusPanelId) {
                        setTimeout(() => {
                            console.log('[面板管理] 尝试聚焦剩余面板:', newFocusPanelId);
                            focusPanel(newFocusPanelId);
                            bindPanelEvents();
                        }, 100);
                    }
                }
            }

            // 如果关闭的是当前聚焦的面板，重置聚焦 ID
            if (focusedPanelId === panelId) {
                focusedPanelId = null;
            }

            // 如果关闭的是当前选中的面板，重置选中 ID
            if (selectedPanelId === panelId) {
                selectedPanelId = null;
            }
        },
        '确认关闭' // 标题
    );
}

/**
 * 显示空状态提示
 */
function showEmptyState() {
    const container = document.getElementById('terminalContainer');
    if (container) {
        container.innerHTML = `
            <div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #888;">
                <svg style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5;" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                </svg>
                <div style="font-size: 16px; margin-bottom: 8px;">没有打开的终端</div>
                <div style="font-size: 12px; color: #666;">按 Ctrl+T 或点击 + 按钮打开新终端</div>
            </div>
        `;
    }
}

/**
 * 绑定工具栏按钮事件
 */
function bindToolbarButtonEvents() {
    // 工具栏 - 关闭面板
    const closePanelBtn = document.getElementById('close-panel-btn');
    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', function() {
            console.log('[工具栏] 点击关闭面板按钮');

            // 获取当前获得焦点的面板
            const activeSession = sessions.find(s => s.status === 'active');
            let panelIdToClose = null;

            if (activeSession) {
                // 优先使用 focusedPanelId
                panelIdToClose = activeSession.focusedPanelId || activeSession.activePanelId;
            }

            // 如果还是会话中没有找到，使用全局 selectedPanelId
            if (!panelIdToClose) {
                panelIdToClose = selectedPanelId;
            }

            if (!panelIdToClose) {
                console.log('[工具栏] 没有获得焦点的面板，无法关闭');
                return;
            }

            // 获取面板容器并关闭
            const panelContainer = document.getElementById(`${panelIdToClose}-container`);
            if (panelContainer) {
                console.log('[工具栏] 关闭面板:', panelIdToClose);
                closePanel(panelContainer);
            } else {
                console.log('[工具栏] 未找到面板容器:', panelIdToClose);
            }
        });
    }
}

/**
 * 更新布局选择器状态
 * 根据是否有选中的面板来更新 UI 状态
 */
function updateLayoutSelectorState() {
    const activeSession = sessions.find(s => s.status === 'active');
    const hasSelectedPanel = activeSession ? !!activeSession.selectedPanelId : !!selectedPanelId;

    console.log('[布局选择器] 更新状态，是否有选中的面板:', hasSelectedPanel);

    // 这里可以添加更新 UI 状态的逻辑，比如启用/禁用分割按钮
    // 目前主要依赖 selectedPanelId 变量来跟踪状态
}

