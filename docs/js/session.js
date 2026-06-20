/**
 * Nexus 会话管理模块
 *
 * 功能说明：
 * 1. 会话列表渲染
 * 2. 会话切换功能
 * 3. 会话创建/删除/重命名
 * 4. 会话状态管理
 */

// ==================== 会话管理数据结构 ====================

// 会话列表数据
let sessions = [];

// 下一个会话 ID
let nextSessionId = 1;

// 会话计数器
let sessionCounter = 0;

// 保存终端面板的原始 HTML（用于删除所有会话后恢复空状态）
let originalTerminalGridHTML = null;
let originalStatusBarHTML = null;

// 记录是否已经保存过空状态 HTML
let isEmptyStateSaved = false;

// 当前右键点击的会话 ID 和名称
let rightClickedSessionId = null;
let rightClickedSessionName = null;

// 记录上一个活动会话 ID（用于删除后切换）
let previousActiveSessionId = null;

// 当前布局模式
let currentLayoutMode = 'horizontal'; // 'horizontal' = 左右分屏，'vertical' = 上下分屏

// 当前选中的面板 ID（用于树形分割）
let selectedPanelId = null;

// 隐藏的面板存储容器（用于切换会话时保存面板）
let hiddenPanelStorage = null;

// ==================== 树形布局核心函数 ====================

/**
 * 根据布局树渲染 DOM
 * @param {Object} node - 布局树节点
 * @param {HTMLElement} container - 目标容器
 * @param {Map} panelRefs - 保存的面板元素引用 Map
 * @param {string} selectedPanelId - 当前选中的面板 ID（用于恢复选中状态）
 */
function renderLayoutTree(node, container, panelRefs = new Map(), selectedPanelId = null) {
    if (!node || !container) return;

    if (node.type === 'panel') {
        let panelEl = panelRefs.get(node.id);
        if (!panelEl) {
            panelEl = document.getElementById(`${node.id}-container`);
        }

        if (panelEl) {
            container.appendChild(panelEl);
            panelEl.style.display = 'flex';
            panelEl.style.flex = '1 1 0';
            panelEl.style.width = '100%';
            panelEl.style.height = '100%';
            // 恢复选中状态
            if (selectedPanelId && node.id === selectedPanelId) {
                panelEl.classList.add('selected');
            } else {
                panelEl.classList.remove('selected');
            }
        } else {
            // 面板元素还不存在，创建一个占位容器
            const placeholderContainer = document.createElement('div');
            placeholderContainer.id = `${node.id}-container-placeholder`;
            placeholderContainer.className = 'layout-child';
            placeholderContainer.style.cssText = 'flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden;';
            container.appendChild(placeholderContainer);
        }
    } else {
        // 容器节点：创建嵌套容器
        container.style.display = 'flex';
        container.style.flexDirection = node.type === 'horizontal' ? 'row' : 'column';

        node.children.forEach(child => {
            const childContainer = document.createElement('div');
            childContainer.className = 'layout-child';
            childContainer.style.cssText = 'flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column;';
            renderLayoutTree(child, childContainer, panelRefs, selectedPanelId);
            container.appendChild(childContainer);
        });
    }
}

/**
 * 递归替换树中的节点
 * @param {Object} node - 当前节点
 * @param {string} targetId - 目标面板 ID
 * @param {Object} newNode - 新节点
 */
function replaceNodeInTree(node, targetId, newNode) {
    if (!node) return null;

    if (node.type === 'panel' && node.id === targetId) {
        return newNode;
    }

    if (node.children) {
        return {
            ...node,
            children: node.children.map(child => replaceNodeInTree(child, targetId, newNode))
        };
    }

    return node;
}

/**
 * 从树中移除节点并简化结构
 * @param {Object} node - 当前节点
 * @param {string} targetId - 目标面板 ID
 * @returns {Object|null} 简化后的节点
 */
function removeNodeFromTree(node, targetId) {
    if (!node) return null;

    if (node.type === 'panel' && node.id === targetId) {
        return null; // 标记为删除
    }

    if (node.children) {
        const newChildren = node.children
            .map(child => removeNodeFromTree(child, targetId))
            .filter(child => child !== null);

        // 如果只剩一个子节点，自动展开
        if (newChildren.length === 1) {
            return newChildren[0];
        }

        return { ...node, children: newChildren };
    }

    return node;
}

/**
 * 找到包含目标面板的直接容器节点
 * @param {Object} node - 当前节点
 * @param {string} targetPanelId - 目标面板 ID
 */
function findParentLayout(node, targetPanelId) {
    if (!node || !node.children) return null;

    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'panel' && child.id === targetPanelId) {
            return node;
        }
        if (child.type !== 'panel') {
            const result = findParentLayout(child, targetPanelId);
            if (result) return result;
        }
    }

    return null;
}

/**
 * 获取当前选中的面板 ID
 */
function getSelectedPanelId() {
    const activeSession = sessions.find(s => s.status === 'active');

    // 优先从会话中获取选中的面板 ID
    if (activeSession && activeSession.selectedPanelId) {
        // 验证面板是否存在
        const panelContainer = document.getElementById(`${activeSession.selectedPanelId}-container`);
        if (panelContainer) {
            return activeSession.selectedPanelId;
        }
    }

    // 向后兼容：从 DOM 中查找
    const selectedEl = document.querySelector('.terminal-container.selected');
    if (selectedEl) {
        const containerId = selectedEl.id;
        return containerId.replace('-container', '');
    }

    // 最后使用全局变量（向后兼容）
    return selectedPanelId;
}

/**
 * 渲染会话列表
 */
function renderSessionList() {
    const recentList = document.getElementById('recent-sessions-list');
    const allList = document.getElementById('all-sessions-list');

    // 清空列表
    recentList.innerHTML = '';
    allList.innerHTML = '';

    // 如果没有会话了，显示空状态
    if (sessions.length === 0) {
        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            // 查找空状态提示元素并显示
            const emptyStateEl = panelsContainer.querySelector('div.flex-1.flex.items-center.justify-center.text-gray-500');
            if (emptyStateEl) {
                emptyStateEl.style.display = 'flex';
                console.log('[会话管理] renderSessionList: 显示空状态提示');
            } else {
                // 如果没有找到，重新创建空状态 HTML
                panelsContainer.innerHTML = '<div class="flex-1 flex items-center justify-center text-gray-500"><div class="text-center"><p class="text-lg mb-2">没有会话</p><p class="text-sm">请点击左侧边栏底部的 [+] 按钮新建会话</p></div></div>';
                console.log('[会话管理] renderSessionList: 重新创建空状态提示');
            }
            // 移除网格布局类
            panelsContainer.classList.remove('grid');
        }

        // 保存并清空状态栏
        const statusBar = document.getElementById('status-bar');
        if (statusBar) {
            if (!originalStatusBarHTML) {
                originalStatusBarHTML = statusBar.innerHTML;
            }
            statusBar.innerHTML = '';
        }
        return;
    }

    // 有会话时，隐藏空状态提示（如果存在）
    const panelsContainer = document.getElementById('panels-container');
    if (panelsContainer) {
        // 查找并隐藏空状态提示元素
        const emptyStateEl = panelsContainer.querySelector('div.flex-1.flex.items-center.justify-center.text-gray-500');
        if (emptyStateEl) {
            emptyStateEl.style.display = 'none';
            console.log('[会话管理] renderSessionList: 隐藏空状态提示');
        }
        // 修改样式类
        panelsContainer.classList.remove('flex', 'items-center', 'justify-center');
        panelsContainer.classList.add('flex');
        console.log('[会话管理] renderSessionList: 恢复面板容器样式');
    }

    // 恢复状态栏 HTML（如果之前被清空了）
    if (originalStatusBarHTML) {
        const statusBar = document.getElementById('status-bar');
        if (statusBar) {
            statusBar.innerHTML = originalStatusBarHTML;
        }
    }

    // 获取活动会话
    const activeSession = sessions.find(s => s.status === 'active');

    // 渲染最近使用（前 3 个）
    const recentSessions = sessions.slice(0, Math.min(3, sessions.length));
    recentSessions.forEach(session => {
        const item = createSessionItem(session, session.id === activeSession?.id);
        recentList.appendChild(item);
    });

    // 渲染全部会话
    sessions.forEach(session => {
        const item = createSessionItem(session, session.id === activeSession?.id);
        allList.appendChild(item);
    });
}

/**
 * 创建会话列表项元素
 */
function createSessionItem(session, isActive) {
    const div = document.createElement('div');
    // 根据当前主题调整选中样式
    const activeStyle = currentTheme === 'light' || currentTheme === 'pink'
        ? 'bg-blue-100 border border-blue-400'  // 浅色主题：淡蓝色背景 + 蓝色边框
        : 'bg-gray-700 border border-green-500';  // 深色主题：深灰色背景 + 绿色边框

    div.className = 'session-item mx-2 mb-1 px-3 py-2 rounded flex items-center gap-3 cursor-pointer ' +
        (isActive ? activeStyle : 'hover:border-gray-600 group');
    div.dataset.sessionId = session.id;

    // 根据主题调整文字颜色
    const textColorClass = currentTheme === 'light' || currentTheme === 'pink'
        ? (isActive ? 'text-gray-900' : 'text-gray-700')  // 浅色主题：深色文字
        : (isActive ? 'text-gray-100' : 'text-gray-300');  // 深色主题：浅色文字

    const subTextClass = currentTheme === 'light' || currentTheme === 'pink'
        ? (isActive ? 'text-gray-600' : 'text-gray-500')  // 浅色主题：次级文字
        : 'text-gray-500';  // 深色主题：次级文字

    div.innerHTML = `
        <div class="w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-500'}"></div>
        <div class="flex-1 min-w-0">
            <div class="session-name text-sm font-medium ${isActive ? textColorClass : 'text-gray-500'} truncate">${session.name}</div>
            <div class="text-[10px] ${subTextClass} truncate">${session.shell} - ${session.path}</div>
        </div>
        <button class="edit-session-btn text-gray-400 hover:text-blue-400 transition-colors ${isActive ? '' : 'opacity-0 group-hover:opacity-100'}" title="重命名">
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
        </button>
        <button class="close-session-btn text-gray-400 hover:text-red-500 transition-colors ${isActive ? '' : 'opacity-0 group-hover:opacity-100'}" title="关闭会话">
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        </button>
    `;

    // 点击会话项切换会话
    div.addEventListener('click', function(e) {
        if (!e.target.closest('.close-session-btn') && !e.target.closest('.edit-session-btn')) {
            switchSession(session.id);
        }
    });

    // 右键点击会话项，记录当前会话 ID
    div.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        rightClickedSessionId = session.id;
        rightClickedSessionName = session.name;
        // 显示右键菜单（传递 isSession 参数）
        showContextMenu(e.clientX, e.clientY, null, true);
    });

    // 点击编辑按钮重命名
    const editBtn = div.querySelector('.edit-session-btn');
    editBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showRenameModal(session.id, session.name);
    });

    // 点击关闭按钮删除会话
    const closeBtn = div.querySelector('.close-session-btn');
    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteSession(session.id);
    });

    return div;
}

/**
 * 切换会话
 */
function switchSession(sessionId) {
    console.log('[会话管理] 切换到会话:', sessionId);

    // 记录当前活动会话 ID（用于删除后切换）
    const currentActiveSession = sessions.find(s => s.status === 'active');
    if (currentActiveSession && currentActiveSession.id !== sessionId) {
        previousActiveSessionId = currentActiveSession.id;
    }

    // 更新会话状态
    sessions.forEach(session => {
        session.status = session.id === sessionId ? 'active' : 'inactive';
    });

    // 更新状态栏显示
    const activeSession = sessions.find(s => s.id === sessionId);
    if (activeSession) {
        const statusText = document.querySelector('#status-bar .font-medium');
        if (statusText) {
            statusText.textContent = activeSession.name;
        }

        // 获取面板容器
        const panelsContainer = document.getElementById('panels-container');

        // 如果该会话还没有面板，创建一个新面板
        if (!activeSession.panelIds || activeSession.panelIds.length === 0) {
            console.log('[会话管理] 会话没有面板，创建新面板');
            console.log('[会话管理] 面板容器:', panelsContainer);
            console.log('[会话管理] 会话路径:', activeSession.path);

            // 初始化隐藏面板存储容器（如果还没有）
            if (!hiddenPanelStorage) {
                hiddenPanelStorage = document.createElement('div');
                hiddenPanelStorage.id = 'hidden-panel-storage';
                hiddenPanelStorage.style.cssText = 'display: none; position: absolute; top: 0; left: 0; width: 0; height: 0;';
                document.body.appendChild(hiddenPanelStorage);
                console.log('[会话管理] 已创建隐藏面板存储容器');
            }

            // 将所有现有面板移动到隐藏存储容器（防止被误用）
            const allContainers = document.querySelectorAll('.terminal-container');
            console.log('[会话管理] 移动现有面板到隐藏存储，数量:', allContainers.length);
            allContainers.forEach(container => {
                hiddenPanelStorage.appendChild(container);
            });

            // 设置容器样式（不要清空，createPanel 会处理）
            if (panelsContainer) {
                panelsContainer.classList.add('flex');
                panelsContainer.classList.remove('items-center', 'justify-center');
                console.log('[会话管理] 已设置面板容器样式');
            }

            const panelId = createPanel(activeSession.path);
            console.log('[会话管理] createPanel 返回值:', panelId);

            if (panelId) {
                activeSession.panelIds.push(panelId);
                activeSession.activePanelId = panelId;
                console.log('[会话管理] 已创建面板:', panelId);
                console.log('[会话管理] 活动会话:', activeSession);

                // 确保新面板显示
                const containerEl = document.getElementById(`${panelId}-container`);
                console.log('[会话管理] 查找容器元素 ID:', `${panelId}-container`, '结果:', containerEl);

                if (containerEl) {
                    containerEl.style.display = 'flex';
                    console.log('[会话管理] 显示新面板容器');
                } else {
                    console.error('[会话管理] 未找到容器元素!');
                }

                // 单个面板占满整个容器
                if (panelsContainer) {
                    panelsContainer.style.display = 'flex';
                }

                // 更新布局样式
                updateLayoutStyle(1);

                // 等待终端初始化完成后再聚焦和选中（与 createPanel 中的 setTimeout timing 一致）
                setTimeout(() => {
                    console.log('[会话管理] 终端初始化完成，准备聚焦和选中:', panelId);
                    focusPanel(panelId);
                    selectPanel(panelId);
                }, 200);

                // 等待 300ms 确保布局完成后 resize 终端
                setTimeout(() => {
                    console.log('[会话管理] === 开始执行 resize ===');
                    const term = terminals[panelId];
                    if (term) {
                        const element = document.getElementById(panelId);
                        if (element) {
                            const rect = element.getBoundingClientRect();
                            const parentRect = element.parentElement.getBoundingClientRect();
                            const fontSize = 14;
                            const lineHeight = 1.2;
                            const charWidth = 8.4;
                            const charHeight = fontSize * lineHeight;
                            const cols = Math.floor(rect.width / charWidth);
                            const rows = Math.floor(rect.height / charHeight);

                            console.log('[会话管理] === 初始化后 resize ===');
                            console.log('  终端元素尺寸:', rect.width, 'x', rect.height);
                            console.log('  父容器尺寸:', parentRect.width, 'x', parentRect.height);
                            console.log('  计算字符尺寸:', charWidth, 'x', charHeight);
                            console.log('  计算行列数:', cols, 'x', rows);
                            console.log('  终端当前尺寸:', term.rows, 'x', term.cols);

                            if (cols > 0 && rows > 0) {
                                term.resize(cols, rows);
                                console.log('  resize 后终端尺寸:', term.rows, 'x', term.cols);
                            }
                            console.log('[会话管理] === resize 完成 ===');
                        } else {
                            console.error('[会话管理] 未找到终端元素');
                        }
                    } else {
                        console.error('[会话管理] 未找到终端实例');
                    }
                }, 300);
            } else {
                console.error('[会话管理] createPanel 返回 null 或 undefined');
            }
        } else {
            console.log('[会话管理] 会话已有面板:', activeSession.panelIds);

            // 初始化隐藏面板存储容器（如果还没有）
            if (!hiddenPanelStorage) {
                hiddenPanelStorage = document.createElement('div');
                hiddenPanelStorage.id = 'hidden-panel-storage';
                hiddenPanelStorage.style.cssText = 'display: none; position: absolute; top: 0; left: 0; width: 0; height: 0;';
                document.body.appendChild(hiddenPanelStorage);
                console.log('[会话管理] 已创建隐藏面板存储容器');
            }

            // 获取面板容器
            const panelsContainer = document.getElementById('panels-container');

            // 将所有现有面板移动到隐藏存储容器（防止被 innerHTML = '' 删除）
            const allContainers = document.querySelectorAll('.terminal-container');
            console.log('[会话管理] 找到面板数量:', allContainers.length);
            allContainers.forEach(container => {
                container.style.display = 'none';
                // 移动到隐藏存储容器
                hiddenPanelStorage.appendChild(container);
                console.log('[会话管理] 移动面板到隐藏存储:', container.id);
            });

            console.log('[会话管理] 隐藏存储容器中的面板数量:', hiddenPanelStorage.children.length);

            // 显示该会话的所有面板 - 使用布局树渲染
            if (panelsContainer) {
                // 先保存所有现有面板元素的引用
                const panelRefs = new Map();
                activeSession.panelIds.forEach(id => {
                    const panelEl = document.getElementById(`${id}-container`);
                    if (panelEl) {
                        panelRefs.set(id, panelEl);
                        console.log('[会话管理] 保存面板引用:', id, '元素存在:', !!panelEl);
                    } else {
                        console.warn('[会话管理] 未找到面板元素:', id);
                    }
                });

                console.log('[会话管理] panelRefs 大小:', panelRefs.size);
                console.log('[会话管理] activeSession.layout:', activeSession.layout);
                console.log('[会话管理] currentLayoutMode:', currentLayoutMode);

                // 清空容器
                panelsContainer.innerHTML = '';

                // 优先使用布局树渲染，如果没有则使用旧的 panelIds 方式
                if (activeSession.layout) {
                    console.log('[会话管理] 使用布局树渲染');
                    renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, selectedPanelId);
                } else if (activeSession.panelIds && activeSession.panelIds.length > 0) {
                    // 向后兼容：从 panelIds 构建简单布局树
                    console.log('[会话管理] 从 panelIds 构建布局树');
                    activeSession.layout = {
                        type: currentLayoutMode,
                        children: activeSession.panelIds.map(id => ({ type: 'panel', id }))
                    };
                    console.log('[会话管理] 新构建的布局树:', activeSession.layout);
                    renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, selectedPanelId);
                }

                // 验证渲染结果
                console.log('[会话管理] 渲染后面板容器子元素数量:', panelsContainer.children.length);
                activeSession.panelIds.forEach(id => {
                    const containerEl = document.getElementById(`${id}-container`);
                    console.log('[会话管理] 验证面板容器:', id, '是否存在:', !!containerEl);
                });
            }

            // 等待 300ms 确保布局完成后 resize 所有终端
            setTimeout(() => {
                console.log('[会话管理] === 切换会话后开始 resize ===');
                activeSession.panelIds.forEach(panelId => {
                    const term = terminals[panelId];
                    if (term) {
                        const element = document.getElementById(panelId);
                        if (element) {
                            const rect = element.getBoundingClientRect();
                            const fontSize = 14;
                            const lineHeight = 1.2;
                            const charWidth = 8.4;
                            const charHeight = fontSize * lineHeight;
                            const cols = Math.floor(rect.width / charWidth);
                            const rows = Math.floor(rect.height / charHeight);

                            console.log(`[会话管理] 面板 ${panelId}: ${rect.width} x ${rect.height}, resize: ${cols} x ${rows}`);

                            if (cols > 0 && rows > 0) {
                                term.resize(cols, rows);
                            }
                        }
                    }
                });
                console.log('[会话管理] === 切换会话 resize 完成 ===');
            }, 300);

            // 恢复会话的焦点和选中状态
            const panelToFocus = activeSession.focusedPanelId || activeSession.activePanelId || activeSession.panelIds[0];
            if (panelToFocus) {
                console.log('[会话管理] 恢复会话焦点和选中状态:', panelToFocus);
                focusPanel(panelToFocus);
                // 恢复选中状态（如果会话有选中的面板）
                if (activeSession.selectedPanelId) {
                    // 先调用 selectPanel 恢复选中状态
                    const panelContainer = document.getElementById(`${activeSession.selectedPanelId}-container`);
                    if (panelContainer) {
                        panelContainer.classList.add('selected');
                    }
                }
            }
        }

        // 重新绑定面板点击事件
        bindPanelEvents();

        renderSessionList();
    }

    console.log('[会话管理] 切换完成');
}

/**
 * 删除会话
 */
function deleteSession(sessionId) {
    const index = sessions.findIndex(s => s.id === sessionId);
    if (index > -1) {
        const session = sessions[index];

        // 显示模态确认窗口（添加标题参数）
        showConfirmModal(
            `确定要删除会话 "${session.name}" 吗？`,
            `此操作不可撤销。`,
            function() {
                // 如果要删除的是活动会话，需要先切换到其他会话
                const isDeletingActive = session.status === 'active';

                if (isDeletingActive) {
                    // 优先切换到上一个活动会话，如果没有则选择数组中的其他会话
                    let targetSessionId = null;

                    // 检查上一个活动会话是否还存在且不是当前要删除的会话
                    if (previousActiveSessionId && previousActiveSessionId !== sessionId) {
                        const prevSession = sessions.find(s => s.id === previousActiveSessionId);
                        if (prevSession) {
                            targetSessionId = previousActiveSessionId;
                        }
                    }

                    // 如果没有上一个活动会话，选择数组中的其他会话
                    if (!targetSessionId) {
                        if (index > 0) {
                            // 有前一个会话
                            targetSessionId = sessions[index - 1].id;
                        } else if (index < sessions.length - 1) {
                            // 没有前一个，但有后一个
                            targetSessionId = sessions[index + 1].id;
                        }
                    }

                    // 先切换会话
                    if (targetSessionId) {
                        switchSession(targetSessionId);
                    }
                }

                // 删除会话对应的所有面板
                if (session.panelIds && session.panelIds.length > 0) {
                    session.panelIds.forEach(panelId => {
                        const panelContainer = document.getElementById(`${panelId}-container`);
                        if (panelContainer) {
                            // 清理终端实例
                            if (terminals[panelId]) {
                                terminals[panelId].dispose();
                                delete terminals[panelId];
                            }
                            panelContainer.remove();
                            console.log('[会话管理] 已删除面板:', panelId);
                        }
                    });
                    session.panelIds = [];
                    session.activePanelId = null;
                }

                // 删除会话
                sessions.splice(index, 1);

                // 重新渲染列表
                renderSessionList();

                console.log('[会话管理] 删除会话:', sessionId);
            }
        );
    }
}

/**
 * 重命名会话
 * @param {string} sessionId - 会话 ID
 * @param {string} newName - 新名称
 */
function renameSession(sessionId, newName) {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
        session.name = newName;
        renderSessionList();
        console.log('[会话管理] 重命名会话:', sessionId, '->', newName);
    }
}

/**
 * 新建会话（显示路径选择对话框）
 */
function createNewSession() {
    console.log('[会话管理] 点击新建会话，显示路径选择对话框');
    // 显示路径选择对话框
    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了路径:', selectedPath);
        // 用户已选择路径，创建新会话
        const newId = String(nextSessionId++);
        const sessionId = 'S' + newId;
        const newSession = {
            id: sessionId,
            name: `bash - ${selectedPath}`,
            shell: 'bash',
            path: selectedPath,
            status: 'inactive',
            pid: nextSessionId,
            panelIds: [],  // 改为数组，支持多个面板
            layout: null,   // 布局树（v2.0 新增）
            focusedPanelId: null,  // 该会话聚焦的面板 ID
            selectedPanelId: null, // 该会话选中的面板 ID
            activePanelId: null    // 该会话活动的面板 ID（用于关闭面板时的焦点恢复）
        };

        sessions.push(newSession);
        console.log('[会话管理] 已创建新会话:', newSession);

        // 新建会话后自动切换过去
        switchSession(sessionId);
        console.log('[会话管理] 已切换到新会话:', sessionId);
    });
}

/**
 * 绑定会话管理事件
 */
function bindSessionEvents() {
    // 侧边栏标题栏的新建按钮
    const addBtn = document.getElementById('add-session-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            createNewSession();
            hideContextMenu();
        });
    }

    // 底部新建会话按钮
    const newBtn = document.getElementById('new-session-btn');
    if (newBtn) {
        newBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            createNewSession();
            hideContextMenu();
        });
    }

    // 右键菜单 - 新建会话
    const contextMenuNewSession = document.getElementById('context-menu-new-session');
    if (contextMenuNewSession) {
        contextMenuNewSession.addEventListener('click', function(e) {
            e.stopPropagation();
            createNewSession();
            hideContextMenu();
        });
    }

    // 右键菜单 - 重命名会话
    const contextMenuRenameSession = document.getElementById('context-menu-rename-session');
    if (contextMenuRenameSession) {
        contextMenuRenameSession.addEventListener('click', function(e) {
            e.stopPropagation();
            // 对右键点击的会话进行重命名
            if (rightClickedSessionId) {
                showRenameModal(rightClickedSessionId, rightClickedSessionName);
            }
            hideContextMenu();
        });
    }

    // 顶部工具栏 - 新增面板按钮
    const addPanelBtn = document.getElementById('add-panel-btn');
    if (addPanelBtn) {
        addPanelBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            addPanelToCurrentSession();
        });
    }

    // 顶部工具栏 - 新增文件面板按钮
    const addFilePanelBtn = document.getElementById('add-file-panel-btn');
    if (addFilePanelBtn) {
        addFilePanelBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            addFilePanelToCurrentSession();
        });
    }

    // 顶部工具栏 - 新增浏览器面板按钮
    const addBrowserPanelBtn = document.getElementById('add-browser-panel-btn');
    if (addBrowserPanelBtn) {
        addBrowserPanelBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            addBrowserPanelToCurrentSession();
        });
    }

    // 顶部工具栏 - 水平分割按钮（设置为布局模式）
    const splitHorizontalBtn = document.getElementById('split-horizontal-btn');
    const splitVerticalBtn = document.getElementById('split-vertical-btn');

    if (splitHorizontalBtn) {
        splitHorizontalBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            // 只设置布局模式，不做其他操作
            currentLayoutMode = 'horizontal';
            console.log('[会话管理] 设置布局模式：左右分屏');

            // 更新按钮状态
            splitHorizontalBtn.classList.add('active');
            if (splitVerticalBtn) splitVerticalBtn.classList.remove('active');
        });
    }

    if (splitVerticalBtn) {
        splitVerticalBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            // 只设置布局模式，不做其他操作
            currentLayoutMode = 'vertical';
            console.log('[会话管理] 设置布局模式：上下分屏');

            // 更新按钮状态
            splitVerticalBtn.classList.add('active');
            if (splitHorizontalBtn) splitHorizontalBtn.classList.remove('active');
        });
    }

    // 右键菜单 - 删除会话
    const contextMenuDeleteSession = document.getElementById('context-menu-delete-session');
    if (contextMenuDeleteSession) {
        contextMenuDeleteSession.addEventListener('click', function(e) {
            e.stopPropagation();
            // 删除右键点击的会话
            if (rightClickedSessionId) {
                deleteSession(rightClickedSessionId);
            }
            hideContextMenu();
        });
    }

    // 右键菜单 - 水平分屏 / 垂直分屏（已改为二级子菜单，通过 handleSplitPanel 处理）

    const contextMenuClosePanel = document.getElementById('context-menu-close-panel');
    if (contextMenuClosePanel) {
        contextMenuClosePanel.addEventListener('click', function(e) {
            e.stopPropagation();
            closePanelFromMenu();
            hideContextMenu();
        });
    }
}

/**
 * 设置布局模式
 * @param {string} mode - 布局模式：'horizontal' (水平分屏) 或 'vertical' (垂直分屏)
 */
function setLayoutMode(mode) {
    currentLayoutMode = mode;
    console.log('[会话管理] 设置布局模式:', mode);

    // 更新分割按钮的 active 状态
    const horizontalBtn = document.getElementById('split-horizontal-btn');
    const verticalBtn = document.getElementById('split-vertical-btn');

    if (horizontalBtn && verticalBtn) {
        if (mode === 'horizontal') {
            horizontalBtn.classList.add('active');
            verticalBtn.classList.remove('active');
        } else {
            horizontalBtn.classList.remove('active');
            verticalBtn.classList.add('active');
        }
    }
}

/**
 * 更新布局样式
 * @param {number} panelCount - 面板数量
 */
function updateLayoutStyle(panelCount) {
    const panelsContainer = document.getElementById('panels-container');
    if (!panelsContainer) return;

    // 只统计 panels-container 中的面板，不包括隐藏存储容器中的
    const allPanels = panelsContainer.querySelectorAll('.terminal-container');
    const actualCount = allPanels.length;

    // 使用实际 DOM 中的面板数量，如果没有则使用传入的参数
    const count = actualCount > 0 ? actualCount : panelCount;

    console.log('[会话管理] 更新布局样式，DOM 中面板数量:', actualCount, '使用数量:', count, '布局模式:', currentLayoutMode);

    // 设置容器占满整个可用空间
    panelsContainer.style.display = 'flex';
    panelsContainer.style.width = '100%';
    panelsContainer.style.height = '100%';

    if (currentLayoutMode === 'horizontal') {
        // 左右分屏：横向排列
        panelsContainer.style.flexDirection = 'row';
    } else {
        // 上下分屏：纵向排列
        panelsContainer.style.flexDirection = 'column';
    }

    // 每个面板平均分配空间，并确保所有面板都显示
    allPanels.forEach((panel, index) => {
        // 确保面板显示
        panel.style.display = 'flex';

        if (allPanels.length === 1) {
            // 单个面板：占满整个容器
            panel.style.flex = '0 0 100%';
            panel.style.width = '100%';
            panel.style.height = '100%';
        } else if (currentLayoutMode === 'horizontal') {
            // 左右分屏：使用 flex: 1 让浏览器自动平均分配宽度
            panel.style.flex = '1 1 0px';
            panel.style.width = '100%';
            panel.style.height = '100%';
        } else {
            // 上下分屏：使用 flex: 1 让浏览器自动平均分配高度
            panel.style.flex = '1 1 0px';
            panel.style.width = '100%';
            panel.style.height = '100%';
        }

        // 调试：获取面板实际尺寸
        const rect = panel.getBoundingClientRect();
        console.log(`[会话管理] 面板 ${index + 1}/${allPanels.length} 样式设置后 - 高度：${rect.height}px, 宽度：${rect.width}px`);
    });

    console.log('[会话管理] 更新布局样式:', currentLayoutMode, '面板数量:', count);
}

/**
 * 为当前会话新增面板
 */
function addPanelToCurrentSession() {
    const activeSession = sessions.find(s => s.status === 'active');

    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，请先创建会话');
        createNewSession();
        return;
    }

    // 检查是否有选中的面板，如果有则使用树形分割
    const selectedPanelId = getSelectedPanelId();
    console.log('[会话管理] addPanelToCurrentSession: selectedPanelId =', selectedPanelId);
    console.log('[会话管理] addPanelToCurrentSession: selectedPanelId(from variable) =', selectedPanelId);
    console.log('[会话管理] addPanelToCurrentSession: selectedPanelId(from global) =', selectedPanelId);
    console.log('[会话管理] addPanelToCurrentSession: selectedPanelId(from DOM) =', document.querySelector('.terminal-container.selected')?.id.replace('-container', ''));
    console.log('[会话管理] addPanelToCurrentSession: selectedPanelId(from global var) =', selectedPanelId);
    if (selectedPanelId) {
        console.log('[会话管理] 检测到选中的面板，使用树形分割:', selectedPanelId);
        splitPanel(selectedPanelId, currentLayoutMode);
        return;
    }

    // 没有选中面板，使用旧的扁平布局方式
    console.log('[会话管理] 新增面板，当前布局模式:', currentLayoutMode);

    // 显示路径选择对话框
    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了路径:', selectedPath);

        // 创建新面板
        const panelId = createPanel(selectedPath, false);

        if (panelId) {
            // 将新面板 ID 添加到会话的面板数组
            activeSession.panelIds.push(panelId);

            // 设置当前活动面板
            activeSession.activePanelId = panelId;

            // 更新布局树（如果还没有设置，则创建简单的布局树）
            if (!activeSession.layout) {
                activeSession.layout = {
                    type: currentLayoutMode,
                    children: activeSession.panelIds.map(id => ({ type: 'panel', id }))
                };
            } else {
                // 如果已有布局树，将新面板添加到根节点
                activeSession.layout.children.push({ type: 'panel', id: panelId });
            }

            console.log('[会话管理] 已创建面板:', panelId, '当前面板列表:', activeSession.panelIds);
            console.log('[会话管理] 布局树:', JSON.stringify(activeSession.layout, null, 2));

            // 使用布局树渲染
            const panelsContainer = document.getElementById('panels-container');
            if (panelsContainer) {
                // 保存面板引用
                const panelRefs = new Map();
                activeSession.panelIds.forEach(id => {
                    const panelEl = document.getElementById(`${id}-container`);
                    if (panelEl) {
                        panelRefs.set(id, panelEl);
                    }
                });

                // 重新渲染布局树
                panelsContainer.innerHTML = '';
                renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, selectedPanelId);
            }

            // 重新绑定面板点击事件（因为新增了面板）
            bindPanelEvents();

            // 等待终端初始化完成后再聚焦和选中（与 createPanel 中的 setTimeout timing 一致）
            setTimeout(() => {
                console.log('[会话管理] 终端初始化完成，准备聚焦和选中:', panelId);
                focusPanel(panelId);
                // 同时设置选中状态，让聚焦和选中保持一致
                selectPanel(panelId);
            }, 200);

            // 等待 100ms 确保布局完成后 resize
            setTimeout(() => {
                console.log('[会话管理] === 新增面板后开始 resize ===');
                // 检查所有面板的尺寸并进行 resize
                activeSession.panelIds.forEach(id => {
                    const term = terminals[id];
                    if (term) {
                        const element = document.getElementById(id);
                        if (element) {
                            const rect = element.getBoundingClientRect();
                            const fontSize = 14;
                            const lineHeight = 1.2;
                            const charWidth = 8.4;
                            const charHeight = fontSize * lineHeight;
                            const cols = Math.floor(rect.width / charWidth);
                            const rows = Math.floor(rect.height / charHeight);
                            if (cols > 0 && rows > 0) {
                                term.resize(cols, rows);
                                console.log(`[会话管理] resize: ${id} -> ${cols} x ${rows}`);
                            } else {
                                console.warn(`[会话管理] 面板尺寸无效：${id}, ${rect.width} x ${rect.height}`);
                            }
                        }
                    }
                });
                console.log('[会话管理] === 新增面板 resize 完成 ===');
            }, 100);
        }
    });
}

/**
 * 新增文件面板到当前会话
 * 显示路径选择器，选择根目录后创建文件浏览器面板
 */
function addFilePanelToCurrentSession() {
    const activeSession = sessions.find(s => s.status === 'active');

    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，创建新会话+文件面板');
        // 显示路径选择对话框
        showPathSelector(function(selectedPath) {
            console.log('[会话管理] 用户选择了文件面板路径:', selectedPath);

            // 创建新会话（不激活，状态设为 inactive）
            const newId = String(nextSessionId++);
            const sessionId = 'S' + newId;
            const newSession = {
                id: sessionId,
                name: `文件 - ${selectedPath}`,
                shell: 'file',
                path: selectedPath,
                status: 'inactive',
                pid: nextSessionId,
                panelIds: [],
                layout: null,
                focusedPanelId: null,
                selectedPanelId: null,
                activePanelId: null
            };
            sessions.push(newSession);
            console.log('[会话管理] 已创建新会话（文件）:', newSession);

            // 先切换为新会话（设为 active）
            newSession.status = 'active';

            // 创建文件面板容器
            const result = createFilePanelElement(selectedPath);
            if (!result) return;
            const { panelId, container } = result;

            newSession.panelIds.push(panelId);
            newSession.activePanelId = panelId;
            newSession.layout = {
                type: currentLayoutMode,
                children: [{ type: 'panel', id: panelId, panelType: 'file' }]
            };

            console.log('[会话管理] 已创建文件面板:', panelId);

            const panelsContainer = document.getElementById('panels-container');
            if (panelsContainer) {
                const panelRefs = new Map();
                panelRefs.set(panelId, container);

                panelsContainer.innerHTML = '';
                renderLayoutTree(newSession.layout, panelsContainer, panelRefs, null);
            }

            bindPanelEvents();
            renderSessionList();
            // 渲染文件列表
            setTimeout(() => renderFileList(panelId, selectedPath, selectedPath), 50);
            setTimeout(() => focusPanel(panelId), 100);
        });
        return;
    }

    // 检查是否有选中的面板，如果有则使用树形分割
    const selectedPanelId = getSelectedPanelId();
    if (selectedPanelId) {
        console.log('[会话管理] 检测到选中的面板，使用树形分割:', selectedPanelId);
        splitPanel(selectedPanelId, currentLayoutMode, 'file');
        return;
    }

    console.log('[会话管理] 新增文件面板');

    // 显示路径选择对话框
    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了文件面板路径:', selectedPath);

        // 创建文件面板容器
        const result = createFilePanelElement(selectedPath);
        if (!result) return;
        const { panelId, container } = result;

        if (panelId) {
            activeSession.panelIds.push(panelId);
            activeSession.activePanelId = panelId;

            if (!activeSession.layout) {
                activeSession.layout = {
                    type: currentLayoutMode,
                    children: activeSession.panelIds.map(id => ({ type: 'panel', id, panelType: id === panelId ? 'file' : 'terminal' }))
                };
            } else {
                activeSession.layout.children.push({ type: 'panel', id: panelId, panelType: 'file' });
            }

            console.log('[会话管理] 已创建文件面板:', panelId);
            console.log('[会话管理] 布局树:', JSON.stringify(activeSession.layout, null, 2));

            const panelsContainer = document.getElementById('panels-container');
            if (panelsContainer) {
                const panelRefs = new Map();
                activeSession.panelIds.forEach(id => {
                    if (id === panelId) {
                        panelRefs.set(id, container);
                    } else {
                        const panelEl = document.getElementById(`${id}-container`);
                        if (panelEl) panelRefs.set(id, panelEl);
                    }
                });

                panelsContainer.innerHTML = '';
                renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
            }

            bindPanelEvents();
            // 渲染文件列表
            setTimeout(() => renderFileList(panelId, selectedPath, selectedPath), 50);
            setTimeout(() => focusPanel(panelId), 100);
        }
    });
}

/**
 * 按指定方向新增文件面板（用于右键菜单子菜单，当没有选中面板时）
 * @param {string} direction - 布局方向：'horizontal' (左右) | 'vertical' (上下)
 */
function addFilePanelToCurrentSessionWithDirection(direction) {
    const activeSession = sessions.find(s => s.status === 'active');

    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，创建新会话+文件面板');
        showPathSelector(function(selectedPath) {
            console.log('[会话管理] 用户选择了文件面板路径:', selectedPath);

            const newId = String(nextSessionId++);
            const sessionId = 'S' + newId;
            const newSession = {
                id: sessionId,
                name: `文件 - ${selectedPath}`,
                shell: 'file',
                path: selectedPath,
                status: 'inactive',
                pid: nextSessionId,
                panelIds: [],
                layout: null,
                focusedPanelId: null,
                selectedPanelId: null,
                activePanelId: null
            };
            sessions.push(newSession);
            newSession.status = 'active';

            const result = createFilePanelElement(selectedPath);
            if (!result) return;
            const { panelId, container } = result;

            newSession.panelIds.push(panelId);
            newSession.activePanelId = panelId;
            newSession.layout = {
                type: direction,
                children: [{ type: 'panel', id: panelId, panelType: 'file' }]
            };

            const panelsContainer = document.getElementById('panels-container');
            if (panelsContainer) {
                const panelRefs = new Map();
                panelRefs.set(panelId, container);
                panelsContainer.innerHTML = '';
                renderLayoutTree(newSession.layout, panelsContainer, panelRefs, null);
            }

            bindPanelEvents();
            renderSessionList();
            setTimeout(() => renderFileList(panelId, selectedPath, selectedPath), 50);
            setTimeout(() => focusPanel(panelId), 100);
        });
        return;
    }

    // 检查是否有选中的面板，如果有则使用树形分割
    const selectedPanelId = getSelectedPanelId();
    if (selectedPanelId) {
        console.log('[会话管理] 检测到选中的面板，使用树形分割:', selectedPanelId);
        splitPanel(selectedPanelId, direction, 'file');
        return;
    }

    console.log('[会话管理] 新增文件面板，指定方向:', direction);

    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了文件面板路径:', selectedPath);

        const result = createFilePanelElement(selectedPath);
        if (!result) return;
        const { panelId, container } = result;

        activeSession.panelIds.push(panelId);
        activeSession.activePanelId = panelId;

        if (!activeSession.layout) {
            activeSession.layout = {
                type: direction,
                children: activeSession.panelIds.map(id => ({ type: 'panel', id, panelType: id === panelId ? 'file' : 'terminal' }))
            };
        } else {
            activeSession.layout.children.push({ type: 'panel', id: panelId, panelType: 'file' });
        }

        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            const panelRefs = new Map();
            activeSession.panelIds.forEach(id => {
                if (id === panelId) {
                    panelRefs.set(id, container);
                } else {
                    const panelEl = document.getElementById(`${id}-container`);
                    if (panelEl) panelRefs.set(id, panelEl);
                }
            });

            panelsContainer.innerHTML = '';
            renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
        }

        bindPanelEvents();
        setTimeout(() => renderFileList(panelId, selectedPath, selectedPath), 50);
        setTimeout(() => focusPanel(panelId), 100);
    });
}

/**
 * 按指定方向新增面板（用于右键菜单，当没有选中面板时）
 * @param {string} direction - 布局方向：'horizontal' (左右) | 'vertical' (上下)
 */
function addPanelToCurrentSessionWithDirection(direction) {
    const activeSession = sessions.find(s => s.status === 'active');

    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，请先创建会话');
        createNewSession();
        return;
    }

    console.log('[会话管理] 新增面板，指定方向:', direction);

    // 显示路径选择对话框
    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了路径:', selectedPath);

        // 创建新面板
        const panelId = createPanel(selectedPath, false);

        if (panelId) {
            // 将新面板 ID 添加到会话的面板数组
            activeSession.panelIds.push(panelId);

            // 设置当前活动面板
            activeSession.activePanelId = panelId;

            // 更新布局树（如果还没有设置，则创建简单的布局树）
            if (!activeSession.layout) {
                activeSession.layout = {
                    type: direction,
                    children: activeSession.panelIds.map(id => ({ type: 'panel', id }))
                };
            } else {
                // 如果已有布局树，将新面板添加到根节点
                activeSession.layout.children.push({ type: 'panel', id: panelId });
            }

            console.log('[会话管理] 已创建面板:', panelId, '当前面板列表:', activeSession.panelIds);
            console.log('[会话管理] 布局树:', JSON.stringify(activeSession.layout, null, 2));

            // 使用布局树渲染
            const panelsContainer = document.getElementById('panels-container');
            if (panelsContainer) {
                // 保存面板引用
                const panelRefs = new Map();
                activeSession.panelIds.forEach(id => {
                    const panelEl = document.getElementById(`${id}-container`);
                    if (panelEl) {
                        panelRefs.set(id, panelEl);
                    }
                });

                // 重新渲染布局树
                panelsContainer.innerHTML = '';
                renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
            }

            // 重新绑定面板点击事件（因为新增了面板）
            bindPanelEvents();

            // 等待终端初始化完成后再聚焦和选中（与 createPanel 中的 setTimeout timing 一致）
            setTimeout(() => {
                console.log('[会话管理] 终端初始化完成，准备聚焦和选中:', panelId);
                focusPanel(panelId);
                // 同时设置选中状态，让聚焦和选中保持一致
                selectPanel(panelId);
            }, 200);

            // 等待 100ms 确保布局完成后 resize
            setTimeout(() => {
                console.log('[会话管理] === 新增面板后开始 resize ===');
                // 检查所有面板的尺寸并进行 resize
                activeSession.panelIds.forEach(id => {
                    const term = terminals[id];
                    if (term) {
                        const element = document.getElementById(id);
                        if (element) {
                            const rect = element.getBoundingClientRect();
                            const fontSize = 14;
                            const lineHeight = 1.2;
                            const charWidth = 8.4;
                            const charHeight = fontSize * lineHeight;
                            const cols = Math.floor(rect.width / charWidth);
                            const rows = Math.floor(rect.height / charHeight);
                            if (cols > 0 && rows > 0) {
                                term.resize(cols, rows);
                                console.log(`[会话管理] resize: ${id} -> ${cols} x ${rows}`);
                            } else {
                                console.warn(`[会话管理] 面板尺寸无效：${id}, ${rect.width} x ${rect.height}`);
                            }
                        }
                    }
                });
                console.log('[会话管理] === 新增面板 resize 完成 ===');
            }, 100);
        }
    });
}

/**
 * 为当前会话新增浏览器面板
 */
function addBrowserPanelToCurrentSession() {
    const activeSession = sessions.find(s => s.status === 'active');

    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，创建新会话+浏览器面板');
        // 创建新会话
        const newId = String(nextSessionId++);
        const sessionId = 'S' + newId;
        const newSession = {
            id: sessionId,
            name: '浏览器',
            shell: 'browser',
            path: '~',
            status: 'inactive',
            pid: nextSessionId,
            panelIds: [],
            layout: null,
            focusedPanelId: null,
            selectedPanelId: null,
            activePanelId: null
        };
        sessions.push(newSession);
        newSession.status = 'active';

        // 创建浏览器面板容器
        const result = createBrowserPanelElement();
        if (!result) return;
        const { panelId, container } = result;

        newSession.panelIds.push(panelId);
        newSession.activePanelId = panelId;
        newSession.layout = {
            type: currentLayoutMode,
            children: [{ type: 'panel', id: panelId, panelType: 'browser' }]
        };

        console.log('[会话管理] 已创建浏览器面板:', panelId);

        // 使用 renderLayoutTree 渲染
        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            const panelRefs = new Map();
            panelRefs.set(panelId, container);
            panelsContainer.innerHTML = '';
            renderLayoutTree(newSession.layout, panelsContainer, panelRefs, null);
        }

        bindPanelEvents();
        renderSessionList();
        // 初始化浏览器面板交互
        setTimeout(() => initBrowserPanel(panelId), 50);
        setTimeout(() => focusPanel(panelId), 100);
        return;
    }

    // 检查是否有选中的面板，如果有则使用树形分割
    const selectedPanelId = getSelectedPanelId();
    if (selectedPanelId) {
        console.log('[会话管理] 检测到选中的面板，使用树形分割:', selectedPanelId);
        splitPanel(selectedPanelId, currentLayoutMode, 'browser');
        return;
    }

    console.log('[会话管理] 新增浏览器面板');

    // 创建浏览器面板容器
    const result = createBrowserPanelElement();
    if (!result) return;
    const { panelId, container } = result;

    if (panelId) {
        activeSession.panelIds.push(panelId);
        activeSession.activePanelId = panelId;

        if (!activeSession.layout) {
            activeSession.layout = {
                type: currentLayoutMode,
                children: activeSession.panelIds.map(id => ({ type: 'panel', id, panelType: id === panelId ? 'browser' : 'terminal' }))
            };
        } else {
            activeSession.layout.children.push({ type: 'panel', id: panelId, panelType: 'browser' });
        }

        console.log('[会话管理] 已创建浏览器面板:', panelId);
        console.log('[会话管理] 布局树:', JSON.stringify(activeSession.layout, null, 2));

        // 使用 renderLayoutTree 重新渲染
        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            const panelRefs = new Map();
            activeSession.panelIds.forEach(id => {
                const panelEl = document.getElementById(`${id}-container`);
                if (panelEl) panelRefs.set(id, panelEl);
            });
            panelRefs.set(panelId, container);

            panelsContainer.innerHTML = '';
            renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
        }

        bindPanelEvents();
        // 初始化浏览器面板交互
        setTimeout(() => initBrowserPanel(panelId), 50);
        setTimeout(() => focusPanel(panelId), 100);
    }
}

/**
 * 按指定方向新增浏览器面板（用于右键菜单子菜单，当没有选中面板时）
 * @param {string} direction - 布局方向：'horizontal' (左右) | 'vertical' (上下)
 */
function addBrowserPanelToCurrentSessionWithDirection(direction) {
    const activeSession = sessions.find(s => s.status === 'active');

    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，创建新会话+浏览器面板');
        const newId = String(nextSessionId++);
        const sessionId = 'S' + newId;
        const newSession = {
            id: sessionId,
            name: '浏览器',
            shell: 'browser',
            path: '~',
            status: 'inactive',
            pid: nextSessionId,
            panelIds: [],
            layout: null,
            focusedPanelId: null,
            selectedPanelId: null,
            activePanelId: null
        };
        sessions.push(newSession);
        newSession.status = 'active';

        const result = createBrowserPanelElement();
        if (!result) return;
        const { panelId, container } = result;

        newSession.panelIds.push(panelId);
        newSession.activePanelId = panelId;
        newSession.layout = {
            type: direction,
            children: [{ type: 'panel', id: panelId, panelType: 'browser' }]
        };

        console.log('[会话管理] 已创建浏览器面板:', panelId);

        // 使用 renderLayoutTree 渲染
        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            const panelRefs = new Map();
            panelRefs.set(panelId, container);
            panelsContainer.innerHTML = '';
            renderLayoutTree(newSession.layout, panelsContainer, panelRefs, null);
        }

        bindPanelEvents();
        renderSessionList();
        setTimeout(() => initBrowserPanel(panelId), 50);
        setTimeout(() => focusPanel(panelId), 100);
        return;
    }

    // 检查是否有选中的面板，如果有则使用树形分割
    const selectedPanelId = getSelectedPanelId();
    if (selectedPanelId) {
        console.log('[会话管理] 检测到选中的面板，使用树形分割:', selectedPanelId);
        splitPanel(selectedPanelId, direction, 'browser');
        return;
    }

    console.log('[会话管理] 新增浏览器面板，指定方向:', direction);

    const result = createBrowserPanelElement();
    if (!result) return;
    const { panelId, container } = result;

    activeSession.panelIds.push(panelId);
    activeSession.activePanelId = panelId;

    if (!activeSession.layout) {
        activeSession.layout = {
            type: direction,
            children: activeSession.panelIds.map(id => ({ type: 'panel', id, panelType: id === panelId ? 'browser' : 'terminal' }))
        };
    } else {
        activeSession.layout.children.push({ type: 'panel', id: panelId, panelType: 'browser' });
    }

    // 使用 renderLayoutTree 重新渲染
    const panelsContainer = document.getElementById('panels-container');
    if (panelsContainer) {
        const panelRefs = new Map();
        activeSession.panelIds.forEach(id => {
            const panelEl = document.getElementById(`${id}-container`);
            if (panelEl) panelRefs.set(id, panelEl);
        });
        panelRefs.set(panelId, container);

        panelsContainer.innerHTML = '';
        renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
    }

    bindPanelEvents();
    setTimeout(() => initBrowserPanel(panelId), 50);
    setTimeout(() => focusPanel(panelId), 100);
}

/**
 * 分割面板并添加浏览器面板
 * @param {string} targetPanelId - 目标面板 ID
 * @param {string} direction - 分割方向
 */
function splitPanelWithBrowser(targetPanelId, direction) {
    const activeSession = sessions.find(s => s.status === 'active');
    if (!activeSession) return;

    // 创建浏览器面板 DOM
    const result = createBrowserPanelElement();
    if (!result) return;
    const { panelId, container: newContainer } = result;

    const oldLayout = activeSession.layout || {
        type: currentLayoutMode,
        children: activeSession.panelIds.map(id => ({ type: 'panel', id }))
    };

    const newLayout = {
        type: direction,
        children: [
            { type: 'panel', id: targetPanelId },
            { type: 'panel', id: panelId, panelType: 'browser' }
        ]
    };

    activeSession.layout = replaceNodeInTree(oldLayout, targetPanelId, newLayout);
    console.log('[会话管理] 布局树更新后:', JSON.stringify(activeSession.layout, null, 2));

    // 和终端面板一样：使用 renderLayoutTree + placeholder 替换
    const panelsContainer = document.getElementById('panels-container');
    if (panelsContainer) {
        // 保存所有现有面板引用
        const panelRefs = new Map();
        activeSession.panelIds.forEach(id => {
            const panelEl = document.getElementById(`${id}-container`);
            if (panelEl) {
                panelRefs.set(id, panelEl);
            }
        });
        // 将新浏览器面板也加入引用
        panelRefs.set(panelId, newContainer);

        // 清空并重新渲染
        panelsContainer.innerHTML = '';
        renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
    }

    activeSession.panelIds.push(panelId);
    activeSession.activePanelId = panelId;
    focusPanel(panelId);
    bindPanelEvents();
    // 初始化浏览器面板交互
    setTimeout(() => initBrowserPanel(panelId), 50);
}

/**
 * 分割面板并添加文件面板（不初始化终端）
 * @param {string} targetPanelId - 目标面板 ID
 * @param {string} direction - 分割方向
 */
function splitPanelWithFile(targetPanelId, direction) {
    const activeSession = sessions.find(s => s.status === 'active');
    if (!activeSession) return;

    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了文件面板路径:', selectedPath);

        // 复用 createFilePanelElement 创建文件面板 DOM，确保结构和样式一致
        const result = createFilePanelElement(selectedPath);
        if (!result) return;
        const { panelId, container: newContainer } = result;

        const oldLayout = activeSession.layout || {
            type: currentLayoutMode,
            children: activeSession.panelIds.map(id => ({ type: 'panel', id }))
        };

        const newLayout = {
            type: direction,
            children: [
                { type: 'panel', id: targetPanelId },
                { type: 'panel', id: panelId, panelType: 'file' }
            ]
        };

        activeSession.layout = replaceNodeInTree(oldLayout, targetPanelId, newLayout);
        console.log('[会话管理] 布局树更新后:', JSON.stringify(activeSession.layout, null, 2));

        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            const panelRefs = new Map();
            activeSession.panelIds.forEach(id => {
                const panelEl = document.getElementById(`${id}-container`);
                if (panelEl) panelRefs.set(id, panelEl);
            });
            // 将新文件面板的容器也加入 panelRefs，避免 renderLayoutTree 创建 placeholder
            panelRefs.set(panelId, newContainer);

            panelsContainer.innerHTML = '';
            renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);
        }

        activeSession.panelIds.push(panelId);
        activeSession.activePanelId = panelId;
        focusPanel(panelId);
        bindPanelEvents();
        // 渲染文件列表
        setTimeout(() => renderFileList(panelId, selectedPath, selectedPath), 50);
    });
}

/**
 * 分割面板（终端面板）
 * @param {string} targetPanelId - 目标面板 ID
 * @param {string} direction - 分割方向：'horizontal' (左右) | 'vertical' (上下)
 */
function splitPanel(targetPanelId, direction, panelType = 'terminal') {
    const activeSession = sessions.find(s => s.status === 'active');
    if (!activeSession) {
        console.log('[会话管理] 没有活动会话，请先创建会话');
        return;
    }

    console.log('[会话管理] 分割面板:', targetPanelId, '方向:', direction, '类型:', panelType);

    // 文件面板类型：使用文件面板创建逻辑
    if (panelType === 'file') {
        splitPanelWithFile(targetPanelId, direction);
        return;
    }

    // 浏览器面板类型：使用浏览器面板创建逻辑
    if (panelType === 'browser') {
        splitPanelWithBrowser(targetPanelId, direction);
        return;
    }

    // 终端面板：使用原有逻辑
    showPathSelector(function(selectedPath) {
        console.log('[会话管理] 用户选择了路径:', selectedPath);

        // 先生成新面板 ID 和 HTML
        const panelId = `terminal-${Date.now()}`;
        const panelIndex = ++panelCounter;

        // 创建完整的面板容器
        const newContainer = document.createElement('div');
        newContainer.id = `${panelId}-container`;
        newContainer.className = 'terminal-container flex flex-col';
        newContainer.setAttribute('data-xterm-id', panelIndex);
        newContainer.style.cssText = 'display: flex; flex-direction: column; height: 100%;';

        // 创建面板头部
        const headerDiv = document.createElement('div');
        headerDiv.className = 'panel-header';
        headerDiv.style.cssText = 'background-color: var(--bg-toolbar); border-bottom-color: var(--border-color); color: var(--text-primary); display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; cursor: grab; user-select: none;';
        headerDiv.innerHTML = `
            <div class="flex items-center gap-2" style="cursor: grab;">
                <div class="w-3 h-3 rounded-full bg-green-500"></div>
                <span class="text-gray-300 font-medium">bash - ${selectedPath}</span>
            </div>
            <div class="panel-controls">
                <button class="panel-btn" onclick="closePanelFromHeader(this)">关闭</button>
            </div>
        `;

        // 创建终端容器
        const terminalDiv = document.createElement('div');
        terminalDiv.id = panelId;
        terminalDiv.className = 'flex-1';
        terminalDiv.style.minHeight = '0';
        terminalDiv.style.overflow = 'hidden';

        newContainer.appendChild(headerDiv);
        newContainer.appendChild(terminalDiv);

        // 先更新布局树
        const oldLayout = activeSession.layout || {
            type: currentLayoutMode,
            children: activeSession.panelIds.map(id => ({ type: 'panel', id }))
        };

        // 创建新容器节点（使用新面板 ID）
        const newLayout = {
            type: direction,
            children: [
                { type: 'panel', id: targetPanelId },
                { type: 'panel', id: panelId }
            ]
        };

        // 替换目标节点为新容器
        activeSession.layout = replaceNodeInTree(oldLayout, targetPanelId, newLayout);

        console.log('[会话管理] 布局树更新后:', JSON.stringify(activeSession.layout, null, 2));

        // 重新渲染布局树
        const panelsContainer = document.getElementById('panels-container');
        if (panelsContainer) {
            // 先保存所有现有面板元素的引用，防止被 innerHTML 清空后丢失
            const panelRefs = new Map();
            activeSession.panelIds.forEach(id => {
                const panelEl = document.getElementById(`${id}-container`);
                if (panelEl) {
                    panelRefs.set(id, panelEl);
                }
            });

            // 清空容器
            panelsContainer.innerHTML = '';

            // 渲染布局树（会引用保存的面板元素）
            renderLayoutTree(activeSession.layout, panelsContainer, panelRefs, activeSession.selectedPanelId);

            // 布局树渲染完成后，找到新面板的占位符并替换为实际面板
            const placeholder = document.getElementById(`${panelId}-container-placeholder`);
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.replaceChild(newContainer, placeholder);
                // 确保新面板样式正确
                newContainer.style.display = 'flex';
                newContainer.style.flex = '1 1 0';
                newContainer.style.width = '100%';
                newContainer.style.height = '100%';
                console.log('[会话管理] 新面板已插入到 DOM');
            } else {
                console.warn('[会话管理] 未找到新面板的占位符:', `${panelId}-container-placeholder`);
            }
        }

        // 更新会话面板数组（向后兼容）
        if (!activeSession.panelIds) {
            activeSession.panelIds = [];
        }
        activeSession.panelIds.push(panelId);
        activeSession.activePanelId = panelId;

        console.log('[会话管理] 已创建面板:', panelId, '当前面板列表:', activeSession.panelIds);

        // 先初始化终端，然后再 resize
        initTerminalForPanel(panelId, selectedPath);

        // 终端初始化完成后聚焦和选中（在 initTerminalForPanel 内部已经设置了 terminals[panelId]）
        console.log('[会话管理] 终端初始化完成，准备聚焦和选中:', panelId);
        // 使用 setTimeout 确保终端元素已经准备好
        setTimeout(() => {
            focusPanel(panelId);
            selectPanel(panelId);
        }, 50);
        bindPanelEvents();

        // 等待终端初始化完成后再 resize
        setTimeout(() => {
            console.log('[会话管理] === 分割面板后开始 resize ===');
            console.log('[会话管理] 面板列表:', activeSession.panelIds);
            activeSession.panelIds.forEach(id => {
                const term = terminals[id];
                const element = document.getElementById(id);
                console.log(`[会话管理] 面板 ${id}: term=${!!term}, element=${!!element}`);
                if (term && element) {
                    const rect = element.getBoundingClientRect();
                    const fontSize = 14;
                    const lineHeight = 1.2;
                    const charWidth = 8.4;
                    const charHeight = fontSize * lineHeight;
                    const cols = Math.floor(rect.width / charWidth);
                    const rows = Math.floor(rect.height / charHeight);

                    if (cols > 0 && rows > 0) {
                        term.resize(cols, rows);
                        console.log(`[会话管理] resize: ${id} -> ${cols} x ${rows}`);
                    } else {
                        console.warn(`[会话管理] 面板尺寸无效：${id}, ${rect.width} x ${rect.height}`);
                    }
                }
            });
            console.log('[会话管理] === 分割面板 resize 完成 ===');
        }, 100);
    });
}

/**
 * 为指定面板 ID 初始化终端
 * @param {string} panelId - 面板 ID
 * @param {string} sessionPath - 会话路径
 */
function initTerminalForPanel(panelId, sessionPath) {
    const element = document.getElementById(panelId);
    if (!element) {
        console.error('[会话管理] 未找到终端元素:', panelId);
        return;
    }

    console.log('[会话管理] 开始初始化终端:', panelId);

    const term = new Terminal({
        fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
        fontSize: 14,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block'
    });

    term.open(element);

    // 设置主题
    term.options.theme = getTerminalTheme();

    // 保存终端实例
    terminals[panelId] = term;

    // 写入欢迎信息
    const welcomeMessage = [
        '\x1b[32m欢迎使用 Nexus\x1b[0m',
        '\x1b[36mTerminal Version:\x1b[0m ' + term.rows + 'x' + term.cols,
        '\x1b[36mShell:\x1b[0m bash 5.1.8',
        '\x1b[36mWorking Directory:\x1b[0m ' + sessionPath,
        '\x1b[36mConnected to:\x1b[0m localhost',
        '',
        '\x1b[33m提示:\x1b[0m 这是一个模拟的终端，可用于输入命令',
        '输入 \x1b[32mclear\x1b[0m 清屏，输入 \x1b[32mhelp\x1b[0m 查看帮助',
        '',
    ];

    term.write(welcomeMessage.join('\r\n') + '\r\n');

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
            term.write('\r\n\x1b[36m~\x1b[0m\r\n');
        } else if (data === 'date\n') {
            term.write('\r\n' + new Date().toString() + '\r\n');
        }
    });

    console.log('[会话管理] 终端已初始化:', panelId);
}
