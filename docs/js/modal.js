/**
 * Nexus 模态窗口模块
 *
 * 功能说明：
 * 1. 确认模态窗口
 * 2. 重命名模态窗口
 * 3. 路径选择对话框
 * 4. 原地编辑功能
 */

// ==================== 模态窗口回调函数 ====================

// 确认模态窗口回调
let modalConfirmCallback = null;

// 重命名回调函数
let modalRenameCallback = null;
let currentRenameSessionId = null;

// 路径选择回调函数
let pathSelectorCallback = null;
let selectedPathItem = null;

// 原地编辑
let currentEditElement = null;
let currentEditSessionId = null;

/**
 * 显示确认模态窗口
 * @param {string} message - 主要消息
 * @param {string} subMessage - 次要消息（可选）
 * @param {function} onConfirm - 确认回调函数
 * @param {string} title - 标题（可选，默认"确认删除"）
 */
function showConfirmModal(message, subMessage, onConfirm, title = '确认') {
    const overlay = document.getElementById('confirm-modal-overlay');
    const messageEl = document.getElementById('modal-message');
    const titleEl = document.getElementById('modal-title');

    // 设置标题和消息内容
    if (titleEl) {
        titleEl.textContent = title;
    }
    messageEl.textContent = subMessage ? message + '\n\n' + subMessage : message;

    // 保存回调函数
    modalConfirmCallback = onConfirm;

    // 显示模态窗口
    overlay.style.display = 'flex';
}

/**
 * 隐藏确认模态窗口
 */
function hideConfirmModal() {
    const overlay = document.getElementById('confirm-modal-overlay');
    overlay.style.display = 'none';
    modalConfirmCallback = null;
}

/**
 * 显示重命名模态窗口
 * @param {string} sessionId - 会话 ID
 * @param {string} currentName - 当前会话名称
 */
function showRenameModal(sessionId, currentName) {
    const overlay = document.getElementById('rename-modal-overlay');
    const input = document.getElementById('rename-input');

    // 设置当前会话 ID
    currentRenameSessionId = sessionId;

    // 设置输入框值
    input.value = currentName;

    // 设置回调函数
    modalRenameCallback = function(newName) {
        renameSession(sessionId, newName);
    };

    // 显示模态窗口
    overlay.style.display = 'flex';

    // 聚焦输入框
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
}

/**
 * 隐藏重命名模态窗口
 */
function hideRenameModal() {
    const overlay = document.getElementById('rename-modal-overlay');
    overlay.style.display = 'none';
    modalRenameCallback = null;
    currentRenameSessionId = null;
}

/**
 * 渲染常用路径列表
 */
function renderCommonPathsList() {
    const listContainer = document.getElementById('common-paths-list');
    if (!listContainer) return;

    // 清空现有内容
    listContainer.innerHTML = '';

    // 生成常用路径项的 HTML
    const pathsHTML = config.commonPaths.map(path => {
        return `
            <div class="common-path-item px-4 py-2 cursor-pointer transition-colors flex items-center gap-3 hover:bg-blue-50 hover:text-blue-600 mx-2 rounded" data-path="${path.path}">
                <span class="text-lg">${path.icon}</span>
                <div class="flex-1">
                    <div class="font-medium text-sm">${path.name}</div>
                    <div class="text-xs opacity-75 font-mono">${path.path}</div>
                </div>
                <svg class="icon w-4 h-4 opacity-50" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.42z"/>
                </svg>
            </div>
        `;
    }).join('');

    listContainer.innerHTML = pathsHTML;
}

/**
 * 更新选中路径项的样式
 * @param {HTMLElement} selectedItem - 选中的路径项元素
 */
function updateSelectedPathItem(selectedItem) {
    // 移除所有路径项的选中状态
    const allItems = document.querySelectorAll('.common-path-item');
    allItems.forEach(item => {
        item.classList.remove('bg-blue-500', 'text-white');
        item.classList.add('hover:bg-blue-50', 'hover:text-blue-600');
    });

    // 添加选中状态
    if (selectedItem) {
        selectedItem.classList.remove('hover:bg-blue-50', 'hover:text-blue-600');
        selectedItem.classList.add('bg-blue-500', 'text-white');
        selectedPathItem = selectedItem;
    }
}

/**
 * 显示路径选择对话框
 * @param {function} callback - 选择路径后的回调函数，接收路径参数
 */
function showPathSelector(callback) {
    const overlay = document.getElementById('path-selector-overlay');
    const customInput = document.getElementById('custom-path-input');

    // 保存回调函数
    pathSelectorCallback = callback;

    // 渲染常用路径列表
    renderCommonPathsList();

    // 清空自定义输入框
    if (customInput) {
        customInput.value = '';
        customInput.focus();
    }

    // 显示对话框
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

/**
 * 隐藏路径选择对话框
 */
function hidePathSelector() {
    const overlay = document.getElementById('path-selector-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    pathSelectorCallback = null;
}

/**
 * 处理路径选择
 * @param {string} path - 用户选择的路径
 */
function handlePathSelect(path) {
    console.log('[路径选择] 用户选择了路径:', path);
    console.log('[路径选择] 当前回调函数:', pathSelectorCallback);

    if (pathSelectorCallback && path) {
        // 展开波浪号（浏览器环境中保持原样，因为是前端应用）
        const expandedPath = path;
        console.log('[路径选择] 调用回调，路径:', expandedPath);
        pathSelectorCallback(expandedPath);
    } else {
        console.log('[路径选择] 回调为空或路径为空');
    }
    hidePathSelector();
}

/**
 * 显示原地编辑输入框
 * @param {string} sessionId - 会话 ID
 * @param {string} currentName - 当前名称
 * @param {HTMLElement} targetEl - 目标元素
 */
function showInlineEdit(sessionId, currentName, targetEl) {
    // 保存引用
    currentEditSessionId = sessionId;
    currentEditElement = targetEl;

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'inline-edit-input';
    input.style.cssText = `
        width: 100%;
        padding: 2px 6px;
        font-size: 14px;
        font-weight: 500;
        background-color: white;
        border: 1px solid #60a5fa;
        border-radius: 4px;
        outline: none;
        box-sizing: border-box;
    `;

    // 替换文本内容为输入框
    targetEl.textContent = '';
    targetEl.appendChild(input);

    // 聚焦并选中文本
    setTimeout(() => {
        input.focus();
        input.select();
    }, 10);

    // 回车保存
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName) {
                renameSession(sessionId, newName);
            } else {
                // 空值则恢复原文本
                targetEl.textContent = currentName;
            }
            currentEditElement = null;
            currentEditSessionId = null;
        } else if (e.key === 'Escape') {
            // ESC 取消，恢复原文本
            targetEl.textContent = currentName;
            currentEditElement = null;
            currentEditSessionId = null;
        }
    });

    // 失焦保存
    input.addEventListener('blur', function() {
        const newName = input.value.trim();
        if (newName && currentEditSessionId) {
            renameSession(currentEditSessionId, newName);
        } else if (currentEditElement) {
            currentEditElement.textContent = currentName;
        }
        currentEditElement = null;
        currentEditSessionId = null;
    });
}

/**
 * 绑定模态窗口事件
 */
function bindModalEvents() {
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const overlay = document.getElementById('confirm-modal-overlay');

    // 取消按钮
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            hideConfirmModal();
        });
    }

    // 确认按钮
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            if (modalConfirmCallback) {
                modalConfirmCallback();
            }
            hideConfirmModal();
        });
    }

    // 移除点击遮罩层关闭的功能，强制用户通过按钮操作
    // ESC 键也禁用关闭功能
    // if (overlay) {
    //     overlay.addEventListener('click', function(e) {
    //         if (e.target === overlay) {
    //             hideConfirmModal();
    //         }
    //     });
    // }

    // 移除 ESC 键关闭功能
    // document.addEventListener('keydown', function(e) {
    //     if (e.key === 'Escape' && overlay.style.display === 'flex') {
    //         hideConfirmModal();
    //     }
    // });

    // ==================== 重命名模态窗口事件 ====================
    const renameCancelBtn = document.getElementById('rename-cancel-btn');
    const renameConfirmBtn = document.getElementById('rename-confirm-btn');
    const renameOverlay = document.getElementById('rename-modal-overlay');
    const renameInput = document.getElementById('rename-input');

    // 取消按钮
    if (renameCancelBtn) {
        renameCancelBtn.addEventListener('click', function() {
            hideRenameModal();
        });
    }

    // 确认按钮
    if (renameConfirmBtn) {
        renameConfirmBtn.addEventListener('click', function() {
            if (modalRenameCallback) {
                const newName = renameInput.value.trim();
                if (newName) {
                    modalRenameCallback(newName);
                }
            }
            hideRenameModal();
        });
    }

    // 回车键确认
    if (renameInput) {
        renameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const newName = renameInput.value.trim();
                if (newName && modalRenameCallback) {
                    modalRenameCallback(newName);
                }
                hideRenameModal();
            }
        });
    }

    // 移除点击遮罩层关闭的功能，强制用户通过按钮操作
    // ESC 键也禁用关闭功能
    // if (renameOverlay) {
    //     renameOverlay.addEventListener('click', function(e) {
    //         if (e.target === renameOverlay) {
    //             hideRenameModal();
    //         }
    //     });
    // }

    // 移除 ESC 键关闭功能
    // document.addEventListener('keydown', function(e) {
    //     if (e.key === 'Escape' && renameOverlay && renameOverlay.style.display === 'flex') {
    //         hideRenameModal();
    //     }
    // });

    // ==================== 路径选择对话框事件 ====================
    const pathSelectorCancelBtn = document.getElementById('path-selector-cancel-btn');
    const pathSelectorConfirmBtn = document.getElementById('path-selector-confirm-btn');
    const pathSelectorOverlay = document.getElementById('path-selector-overlay');
    const pathSelectorCommonPaths = document.getElementById('common-paths-list');
    const customPathInput = document.getElementById('custom-path-input');

    // 取消按钮
    if (pathSelectorCancelBtn) {
        pathSelectorCancelBtn.addEventListener('click', function() {
            hidePathSelector();
        });
    }

    // 确认按钮（使用自定义路径）
    if (pathSelectorConfirmBtn) {
        pathSelectorConfirmBtn.addEventListener('click', function() {
            console.log('[路径选择] 确定按钮被点击');
            const path = customPathInput ? customPathInput.value.trim() : '';
            console.log('[路径选择] 输入框中的路径:', path);
            if (path) {
                handlePathSelect(path);
            } else {
                // 如果自定义路径为空，使用默认路径
                handlePathSelect('~');
            }
        });
    }

    // 常用路径点击
    if (pathSelectorCommonPaths) {
        pathSelectorCommonPaths.addEventListener('click', function(e) {
            const pathItem = e.target.closest('.common-path-item');
            if (pathItem) {
                const selectedPath = pathItem.getAttribute('data-path');
                if (selectedPath) {
                    // 更新选中状态
                    updateSelectedPathItem(pathItem);
                    // 填充自定义输入框
                    if (customPathInput) {
                        customPathInput.value = selectedPath;
                        customPathInput.focus();
                    }
                }
            }
        });
    }

    // 自定义路径回车确认
    if (customPathInput) {
        customPathInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const path = customPathInput.value.trim();
                if (path) {
                    handlePathSelect(path);
                } else {
                    handlePathSelect('~');
                }
            }
        });
    }

    // 移除点击遮罩层关闭的功能，强制用户通过按钮操作
    // ESC 键也禁用关闭功能
    // if (pathSelectorOverlay) {
    //     pathSelectorOverlay.addEventListener('click', function(e) {
    //         if (e.target === pathSelectorOverlay) {
    //             hidePathSelector();
    //         }
    //     });
    // }

    // 移除 ESC 键关闭功能
    // document.addEventListener('keydown', function(e) {
    //     if (e.key === 'Escape' && pathSelectorOverlay && pathSelectorOverlay.style.display === 'flex') {
    //         hidePathSelector();
    //     }
    // });
}
