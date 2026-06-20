/**
 * Nexus 右键菜单模块
 *
 * 功能说明：
 * 1. 显示/隐藏右键菜单
 * 2. 右键菜单位置定位
 * 3. 菜单项状态更新
 * 4. 右键点击事件处理
 */

// 右键点击的面板 ID
let rightClickedPanelId = null;
let isMenuShown = false;

/**
 * 显示右键菜单
 * @param {number} x - 菜单 X 坐标
 * @param {number} y - 菜单 Y 坐标
 * @param {string|null} panelId - 右键点击的面板 ID（可选）
 * @param {boolean} isOnSession - 是否在会话项上右键（可选）
 */
function showContextMenu(x, y, panelId = null, isOnSession = false) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.add('show');
    isMenuShown = true;
    rightClickedPanelId = panelId;

    // 更新"关闭面板"选项的禁用状态
    const closePanelItem = document.getElementById('context-menu-close-panel');
    if (closePanelItem) {
        if (!panelId) {
            closePanelItem.classList.add('disabled');
        } else {
            closePanelItem.classList.remove('disabled');
        }
    }

    // 更新"重命名会话"选项的禁用状态
    const renameItem = document.getElementById('context-menu-rename-session');
    if (renameItem) {
        if (!isOnSession) {
            renameItem.classList.add('disabled');
        } else {
            renameItem.classList.remove('disabled');
        }
    }

    // 更新"删除会话"选项的禁用状态
    const deleteItem = document.getElementById('context-menu-delete-session');
    if (deleteItem) {
        if (!isOnSession) {
            deleteItem.classList.add('disabled');
        } else {
            deleteItem.classList.remove('disabled');
        }
    }
}

/**
 * 隐藏右键菜单
 */
function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    contextMenu.classList.remove('show');
    isMenuShown = false;
    hideSubmenus();
}

/**
 * 绑定右键菜单事件
 */
function bindContextMenuEvents() {
    const contextMenu = document.getElementById('context-menu');

    // 阻止默认右键菜单并显示自定义菜单
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // 如果在终端面板上右键，记录面板 ID
        // 注意：data-xterm-id 在最外层的 terminal-container 上，不是 xterm 生成的内部容器
        let panel = e.target.closest('.terminal-container');

        // 如果找到的是内部容器（没有 data-xterm-id），继续向上查找
        if (panel && !panel.getAttribute('data-xterm-id')) {
            panel = panel.parentElement?.closest('.terminal-container') || null;
        }

        // 使用面板容器的 ID（格式为 terminal-xxxx-container），去掉 -container 后缀获取真实面板 ID
        const panelId = panel ? panel.id.replace('-container', '') : null;

        showContextMenu(e.clientX, e.clientY, panelId);
    });

    // 点击其他区域关闭菜单
    document.addEventListener('click', (e) => {
        if (!isMenuShown) return;

        // 如果点击的是菜单内部，不关闭
        if (contextMenu.contains(e.target)) {
            return;
        }

        hideContextMenu();
    });

    // 继续处理 capturedRightClick
    document.addEventListener('capturedRightClick', (e) => {
        showContextMenu(e.detail.x, e.detail.y);
    });

    // 右键菜单 - 关闭面板
    const contextMenuClosePanel = document.getElementById('context-menu-close-panel');
    if (contextMenuClosePanel) {
        contextMenuClosePanel.addEventListener('click', function(e) {
            e.stopPropagation();
            closePanelFromMenu();
            hideContextMenu();
        });
    }

    // 右键菜单 - 删除会话
    const contextMenuDeleteSession = document.getElementById('context-menu-delete-session');
    if (contextMenuDeleteSession) {
        contextMenuDeleteSession.addEventListener('click', function(e) {
            e.stopPropagation();
            // 对右键点击的会话进行删除
            if (rightClickedSessionId) {
                deleteSession(rightClickedSessionId);
            }
            hideContextMenu();
        });
    }

    // 右键菜单 - 新建会话（从会话管理子菜单调用）
    const contextMenuNewSession = document.getElementById('context-menu-new-session');
    if (contextMenuNewSession) {
        contextMenuNewSession.addEventListener('click', function(e) {
            e.stopPropagation();
            handleNewSession();
        });
    }

    // 右键菜单 - 重命名会话（从会话管理子菜单调用）
    const contextMenuRenameSession = document.getElementById('context-menu-rename-session');
    if (contextMenuRenameSession) {
        contextMenuRenameSession.addEventListener('click', function(e) {
            e.stopPropagation();
            // 对右键点击的会话进行重命名
            if (rightClickedSessionId) {
                showRenameModal(rightClickedSessionId, rightClickedSessionName || '');
            }
            hideContextMenu();
        });
    }

    // 右键菜单 - 水平分屏 / 垂直分屏（已改为二级子菜单，通过 handleSplitPanel 处理）
    // 保留原有事件绑定作为降级方案，但不再主动触发
}

/**
 * 新建会话（从右键菜单调用）
 */
function handleNewSession() {
    createNewSession();
    hideContextMenu();
}

/**
 * 显示二级子菜单
 * @param {string} type - 'horizontal' 或 'vertical'
 */
function showSubmenu(type) {
    // 先隐藏所有子菜单
    hideSubmenus();
    const submenu = document.getElementById(type + '-submenu');
    if (submenu) {
        submenu.style.display = 'block';
    }
}

/**
 * 隐藏所有二级子菜单
 */
function hideSubmenus() {
    document.querySelectorAll('.context-menu-submenu-panel').forEach(s => {
        s.style.display = 'none';
    });
}

/**
 * 处理分屏操作（从二级子菜单调用）
 * @param {string} direction - 'horizontal' 或 'vertical'
 * @param {string} panelType - 'terminal'、'file' 或 'browser'
 */
function handleSplitPanel(direction, panelType) {
    const panelId = rightClickedPanelId;

    if (!panelId) {
        if (panelType === 'file') {
            addFilePanelToCurrentSessionWithDirection(direction);
        } else if (panelType === 'browser') {
            addBrowserPanelToCurrentSessionWithDirection(direction);
        } else {
            addPanelToCurrentSessionWithDirection(direction);
        }
    } else {
        splitPanel(panelId, direction, panelType);
    }
    hideContextMenu();
}
