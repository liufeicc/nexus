/**
 * Nexus 智能窗口模块
 *
 * 功能说明：
 * 1. AI 配置面板（打开/关闭/保存）
 * 2. 总控 Agent 按钮（开启/关闭/二次确认）
 * 3. AI 配置状态管理
 */

(function () {
    'use strict';

    // ========== DOM 元素引用 ==========
    const aiConfigBtn = document.getElementById('ai-config-btn');
    const aiSettingsOverlay = document.getElementById('ai-settings-overlay');
    const aiSettingsBackdrop = document.getElementById('ai-settings-backdrop');
    const aiSettingsClose = document.getElementById('ai-settings-close');
    const aiProviderSelect = document.getElementById('ai-provider');
    const aiApiKeyInput = document.getElementById('ai-api-key');
    const aiModelSelect = document.getElementById('ai-model');
    const aiModelInput = document.getElementById('ai-model-input');
    const aiCustomEndpointField = document.getElementById('ai-custom-endpoint-field');
    const aiCustomEndpointInput = document.getElementById('ai-custom-endpoint');
    const aiSaveBtn = document.getElementById('ai-save-btn');
    const aiStatusText = document.getElementById('ai-status-text');
    const aiConfigIcon = document.getElementById('ai-config-icon');

    // ========== 状态 ==========
    // 模拟已保存的配置（原型中用变量代替持久化）
    let aiConfig = {
        provider: '',
        apiKey: '',
        model: '',
        customEndpoint: ''
    };
    let isConfigured = false;
    // 标记是否是通过总控按钮触发的配置
    let openAiFromOrchestrator = false;

    // ========== 模型选项映射 ==========
    const modelOptions = {
        dashscope: [
            { value: 'qwen-turbo', label: 'qwen-turbo' },
            { value: 'qwen-plus', label: 'qwen-plus' },
            { value: 'qwen-max', label: 'qwen-max' }
        ],
        openai: [
            { value: 'gpt-4o', label: 'gpt-4o' },
            { value: 'gpt-4o-mini', label: 'gpt-4o-mini' }
        ],
        custom: [
            { value: 'custom-model', label: '自定义模型' }
        ]
    };

    // ========== 打开 AI 配置面板 ==========
    function openAiSettings(fromOrchestrator) {
        openAiFromOrchestrator = !!fromOrchestrator;
        aiSettingsOverlay.style.display = 'flex';
    }

    // ========== 关闭 AI 配置面板 ==========
    function closeAiSettings() {
        aiSettingsOverlay.style.display = 'none';
    }

    // ========== 更新模型下拉选项 ==========
    function updateModelOptions(provider) {
        const options = modelOptions[provider] || [];
        aiModelSelect.innerHTML = '';
        options.forEach(function (opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            aiModelSelect.appendChild(option);
        });
    }

    // ========== 更新 UI 状态 ==========
    function updateUiState() {
        if (isConfigured) {
            aiStatusText.textContent = '已配置';
            aiStatusText.className = 'ai-status-configured';
            aiConfigIcon.classList.add('configured');
        } else {
            aiStatusText.textContent = '未配置';
            aiStatusText.className = 'ai-status-unconfigured';
            aiConfigIcon.classList.remove('configured');
        }
    }

    // ========== 保存配置 ==========
    function saveConfig() {
        var provider = aiProviderSelect.value;
        var apiKey = aiApiKeyInput.value.trim();
        var model = (provider === 'custom') ? aiModelInput.value.trim() : aiModelSelect.value;
        var customEndpoint = aiCustomEndpointInput.value.trim();

        // 基础验证
        if (!apiKey) {
            aiApiKeyInput.focus();
            aiApiKeyInput.style.borderColor = '#f87171';
            setTimeout(function () {
                aiApiKeyInput.style.borderColor = '';
            }, 2000);
            return;
        }

        // 自定义模型验证
        if (provider === 'custom' && !model) {
            aiModelInput.focus();
            aiModelInput.style.borderColor = '#f87171';
            setTimeout(function () {
                aiModelInput.style.borderColor = '';
            }, 2000);
            return;
        }

        if (provider === 'custom' && !customEndpoint) {
            aiCustomEndpointInput.focus();
            aiCustomEndpointInput.style.borderColor = '#f87171';
            setTimeout(function () {
                aiCustomEndpointInput.style.borderColor = '';
            }, 2000);
            return;
        }

        // 保存配置（原型中仅存内存）
        aiConfig.provider = provider;
        aiConfig.apiKey = apiKey;
        aiConfig.model = model;
        aiConfig.customEndpoint = customEndpoint;
        isConfigured = true;

        // 如果是通过总控按钮触发的配置，同步激活总控
        if (openAiFromOrchestrator) {
            isOrchestratorActive = true;
            orchestratorSquirrel.classList.add('active');
            orchestratorBtn.title = '关闭总控';
            openAiFromOrchestrator = false;
        }

        // 更新 UI
        updateUiState();

        // 延迟关闭面板，给用户视觉反馈
        setTimeout(function () {
            closeAiSettings();
        }, 600);
    }

    // ========== 事件绑定 ==========

    // 点击 AI 配置按钮 → 打开面板
    if (aiConfigBtn) {
        aiConfigBtn.addEventListener('click', function () {
            openAiSettings();
        });
    }

    // 点击遮罩 → 关闭面板
    if (aiSettingsBackdrop) {
        aiSettingsBackdrop.addEventListener('click', function () {
            closeAiSettings();
        });
    }

    // 点击关闭按钮 → 关闭面板
    if (aiSettingsClose) {
        aiSettingsClose.addEventListener('click', function () {
            closeAiSettings();
        });
    }

    // 服务商切换 → 更新模型选项 + 显示/隐藏自定义端点 + 切换模型输入方式
    if (aiProviderSelect) {
        aiProviderSelect.addEventListener('change', function () {
            var provider = this.value;
            updateModelOptions(provider);

            // 自定义 → 模型输入框，其他 → 模型下拉
            if (provider === 'custom') {
                aiModelSelect.style.display = 'none';
                aiModelInput.style.display = 'block';
            } else {
                aiModelSelect.style.display = 'block';
                aiModelInput.style.display = 'none';
            }

            // 自定义端点显示/隐藏
            if (provider === 'custom') {
                aiCustomEndpointField.style.display = 'block';
            } else {
                aiCustomEndpointField.style.display = 'none';
            }
        });
    }

    // 保存按钮
    if (aiSaveBtn) {
        aiSaveBtn.addEventListener('click', function () {
            saveConfig();
        });
    }

    // ESC 键关闭面板
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && aiSettingsOverlay.style.display === 'flex') {
            closeAiSettings();
        }
    });

    // ========== 总控 Agent 按钮 ==========
    const orchestratorBtn = document.getElementById('orchestrator-btn');
    const orchestratorSquirrel = document.getElementById('orchestrator-squirrel');
    let isOrchestratorActive = false;

    /**
     * 切换总控 Agent 状态
     * 点击后先二次确认：
     * - 未配置 AI → 确认后打开 AI 配置面板
     * - 已配置 AI → 确认后直接激活，不打开配置面板
     */
    function toggleOrchestrator() {
        if (!isOrchestratorActive) {
            // 未激活 → 先二次确认
            showConfirmModal(
                '确定要开启会话总控 Agent 吗？',
                '开启后将接收各面板 Agent 的汇报并进行综合决策。',
                function () {
                    // 确认后根据 AI 配置状态决定下一步
                    if (isConfigured) {
                        // 已配置 → 直接激活
                        isOrchestratorActive = true;
                        orchestratorSquirrel.classList.add('active');
                        orchestratorBtn.title = '关闭总控';

                        // 激活后说一句话
                        setTimeout(function () {
                            orchestratorSpeak('总控 Agent 已开启，正在监控各面板状态...');
                        }, 300);
                    } else {
                        // 未配置 → 打开 AI 配置面板
                        openAiSettings(true);
                    }
                },
                '总控 Agent'
            );
        } else {
            // 已激活 → 点击关闭
            isOrchestratorActive = false;
            orchestratorSquirrel.classList.remove('active');
            orchestratorBtn.title = '开启总控';

            // 关闭后说一句话
            orchestratorSpeak('总控 Agent 已关闭');
        }
    }

    if (orchestratorBtn) {
        orchestratorBtn.addEventListener('click', toggleOrchestrator);
    }

    // ========== 说话泡泡共享元素 ==========

    // 创建泡泡 DOM 元素（总控和面板松鼠共用）
    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'orchestrator-bubble';
    bubbleEl.innerHTML =
        '<div class="orchestrator-bubble-content">' +
        '    <span class="orchestrator-bubble-text"></span>' +
        '</div>';
    document.body.appendChild(bubbleEl);

    const bubbleText = bubbleEl.querySelector('.orchestrator-bubble-text');

    // ========== 总控说话 ==========

    function orchestratorSpeak(text) {
        // 如果已经在说话，跳过
        if (orchestratorBtn.classList.contains('speaking')) return;

        // 1. 计算工具栏中心位置
        var toolbar = orchestratorBtn.closest('header') || orchestratorBtn.parentElement;
        var toolbarRect = toolbar.getBoundingClientRect();
        var centerX = toolbarRect.left + toolbarRect.width / 2;
        var centerY = toolbarRect.top + toolbarRect.height / 2;
        var btnRect = orchestratorBtn.getBoundingClientRect();

        // 2. 判断方向：右侧时翻转向左，否则面向右
        var isOnRight = btnRect.left > centerX;

        // 3. 隐藏原按钮
        orchestratorBtn.style.opacity = '0';
        orchestratorBtn.style.transition = 'opacity 0.2s ease';
        orchestratorBtn.classList.add('speaking');

        // 3. 创建飞行的松鼠克隆体
        var flyingSquirrel = orchestratorSquirrel.cloneNode(true);
        flyingSquirrel.style.display = 'inline-flex';
        flyingSquirrel.style.alignItems = 'center';
        flyingSquirrel.style.justifyContent = 'center';
        flyingSquirrel.style.position = 'fixed';
        flyingSquirrel.style.zIndex = '100';
        flyingSquirrel.style.margin = '0';
        flyingSquirrel.style.padding = '0';
        flyingSquirrel.style.opacity = '1';
        flyingSquirrel.style.pointerEvents = 'none';
        flyingSquirrel.style.transform = isOnRight ? 'scaleX(-1)' : 'scaleX(1)';
        document.body.appendChild(flyingSquirrel);

        // 克隆体的实际尺寸
        var flyingRect = flyingSquirrel.getBoundingClientRect();
        var flyingW = flyingRect.width;
        var flyingH = flyingRect.height;

        // 起始位置：原按钮中心（垂直居中）
        flyingSquirrel.style.left = (btnRect.left + btnRect.width / 2 - flyingW / 2) + 'px';
        flyingSquirrel.style.top = (btnRect.top + btnRect.height / 2 - flyingH / 2) + 'px';

        // 4. 强制回流 + 下一帧飞行动画（确保起始位置已渲染）
        flyingSquirrel.getBoundingClientRect();
        requestAnimationFrame(function () {
            flyingSquirrel.style.transition = 'left 0.5s ease, top 0.5s ease';
            // 目标位置：工具栏正中心（完全居中）
            flyingSquirrel.style.left = (centerX - flyingW / 2) + 'px';
            flyingSquirrel.style.top = (centerY - flyingH / 2) + 'px';
        });

        // 5. 0.7s 后显示泡泡 + 流式文字
        setTimeout(function () {
            var currentRect = flyingSquirrel.getBoundingClientRect();
            var bubbleCenterX = currentRect.left + currentRect.width / 2;
            var bubbleTopY = currentRect.bottom + 16; // 松鼠下方

            // 定位泡泡
            bubbleEl.style.left = bubbleCenterX + 'px';
            bubbleEl.style.top = bubbleTopY + 'px';
            bubbleEl.style.transform = 'translate(-50%, 0%)';
            bubbleEl.classList.add('visible');

            // 流式显示文字
            streamText(text, bubbleText, function () {
                // 文字流完后等 2 秒，然后返回
                setTimeout(function () {
                    // 隐藏泡泡
                    bubbleEl.classList.remove('visible');
                    bubbleText.textContent = '';
                    bubbleText.classList.remove('streaming');

                    // 0.3s 后飞回
                    setTimeout(function () {
                        flyingSquirrel.style.transition = 'left 0.5s ease, top 0.5s ease, opacity 0.3s ease';
                        flyingSquirrel.style.left = btnRect.left + 'px';
                        flyingSquirrel.style.top = btnRect.top + 'px';
                        flyingSquirrel.style.opacity = '0';
                        flyingSquirrel.style.transform = isOnRight ? 'scaleX(-1)' : 'scaleX(1)';

                        setTimeout(function () {
                            // 移除飞行克隆体
                            if (flyingSquirrel.parentNode) {
                                flyingSquirrel.parentNode.removeChild(flyingSquirrel);
                            }
                            // 恢复原按钮
                            orchestratorBtn.style.opacity = '';
                            orchestratorBtn.style.transition = '';
                            orchestratorBtn.classList.remove('speaking');
                        }, 500);
                    }, 300);
                }, 2000);
            });
        }, 700);
    }

    /**
     * 流式显示文字（打字机效果）
     * @param {string} text - 完整文字
     * @param {HTMLElement} container - 文字容器
     * @param {function} onComplete - 完成回调
     */
    function streamText(text, container, onComplete) {
        container.textContent = '';
        container.classList.add('streaming');

        var index = 0;
        var speed = 40; // 每个字符的间隔（毫秒）

        function typeNextChar() {
            if (index < text.length) {
                container.textContent += text[index];
                index++;
                setTimeout(typeNextChar, speed);
            } else {
                // 打字完成，移除光标
                container.classList.remove('streaming');
                if (onComplete) onComplete();
            }
        }

        typeNextChar();
    }

    // 暴露给全局，供其他模块调用
    window.orchestratorSpeak = orchestratorSpeak;

    // ========== 面板松鼠说话 ==========

    /**
     * 面板小松鼠说话
     * @param {HTMLElement} squirrel - 小松鼠元素
     * @param {string} text - 要说的话
     */
    function panelSquirrelSpeak(squirrel, text) {
        // 如果已经在说话，跳过
        if (squirrel.dataset.speaking === 'true') return;

        // 1. 获取面板标题栏中心位置（目标位置）
        var panelHeader = squirrel.closest('.panel-header');
        if (!panelHeader) return;
        var headerRect = panelHeader.getBoundingClientRect();
        var centerX = headerRect.left + headerRect.width / 2;
        var centerY = headerRect.top + headerRect.height / 2;
        var squirrelRect = squirrel.getBoundingClientRect();

        // 视觉中心偏移（扳手在松鼠下方，需要向上修正）
        var iconSize = 20; // 松鼠图标的实际视觉尺寸
        var visualCenterY = squirrelRect.top + (iconSize / 2);

        // 2. 隐藏原松鼠
        squirrel.style.opacity = '0';
        squirrel.style.transition = 'opacity 0.2s ease';

        // 3. 判断方向：右侧时翻转向左，否则面向右
        var isOnRight = squirrelRect.left > centerX;

        // 4. 创建飞行的松鼠克隆体
        var flyingSquirrel = squirrel.cloneNode(true);
        flyingSquirrel.style.display = 'inline-flex';
        flyingSquirrel.style.alignItems = 'center';
        flyingSquirrel.style.justifyContent = 'center';
        flyingSquirrel.style.position = 'fixed';
        flyingSquirrel.style.left = squirrelRect.left + 'px';
        flyingSquirrel.style.top = squirrelRect.top + 'px';
        flyingSquirrel.style.zIndex = '100';
        flyingSquirrel.style.margin = '0';
        flyingSquirrel.style.padding = '0';
        flyingSquirrel.style.opacity = '1';
        flyingSquirrel.style.transition = 'none';
        flyingSquirrel.style.pointerEvents = 'none';
        flyingSquirrel.style.transform = isOnRight ? 'scaleX(-1)' : 'scaleX(1)';
        flyingSquirrel.dataset.speaking = 'true';
        document.body.appendChild(flyingSquirrel);

        // 强制回流
        flyingSquirrel.getBoundingClientRect();

        // 5. 飞行到面板标题栏中央
        flyingSquirrel.style.transition = 'left 0.5s ease, top 0.5s ease';
        flyingSquirrel.style.left = (centerX - iconSize / 2) + 'px';
        flyingSquirrel.style.top = (centerY - iconSize / 2) + 'px';

        console.log('[面板松鼠] 开始飞行, 从:', Math.round(squirrelRect.left), Math.round(squirrelRect.top), '到:', Math.round(centerX), Math.round(centerY));

        // 5. 到达后显示泡泡 + 流式文字
        setTimeout(function () {
            var currentRect = flyingSquirrel.getBoundingClientRect();
            var bubbleCenterX = currentRect.left + currentRect.width / 2;
            var bubbleTopY = currentRect.bottom + 16; // 松鼠下方 16px，避免遮挡

            // 定位泡泡
            bubbleEl.style.left = bubbleCenterX + 'px';
            bubbleEl.style.top = bubbleTopY + 'px';
            bubbleEl.style.transform = 'translate(-50%, 0%)';
            bubbleEl.classList.add('visible');

            // 流式显示文字
            streamText(text, bubbleText, function () {
                setTimeout(function () {
                    // 隐藏泡泡
                    bubbleEl.classList.remove('visible');
                    bubbleText.textContent = '';
                    bubbleText.classList.remove('streaming');

                    // 0.3s 后飞回（保持翻转状态）
                    setTimeout(function () {
                        flyingSquirrel.style.transition = 'left 0.5s ease, top 0.5s ease, opacity 0.3s ease';
                        flyingSquirrel.style.left = squirrelRect.left + 'px';
                        flyingSquirrel.style.top = squirrelRect.top + 'px';
                        flyingSquirrel.style.opacity = '0';
                        flyingSquirrel.style.transform = isOnRight ? 'scaleX(-1)' : 'scaleX(1)';

                        setTimeout(function () {
                            // 移除飞行克隆体
                            if (flyingSquirrel.parentNode) {
                                flyingSquirrel.parentNode.removeChild(flyingSquirrel);
                            }
                            // 恢复原松鼠
                            squirrel.style.opacity = '';
                            squirrel.style.transition = '';
                            squirrel.dataset.speaking = 'false';
                            console.log('[面板松鼠] 已返回原位');
                        }, 500);
                    }, 300);
                }, 2000);
            });
        }, 500);
    }

    // 暴露给全局
    window.panelSquirrelSpeak = panelSquirrelSpeak;

    // ========== 面板 AI 小松鼠事件委托 ==========

    // 使用事件委托处理动态创建的面板
    document.addEventListener('click', function (e) {
        var panelSquirrel = e.target.closest('.panel-ai-squirrel');
        if (panelSquirrel) {
            e.stopPropagation(); // 阻止事件冒泡，避免面板点击干扰
            handlePanelSquirrelClick(panelSquirrel);
        }
    });

    /**
     * 处理面板小松鼠点击
     * @param {HTMLElement} squirrel - 小松鼠元素
     */
    function handlePanelSquirrelClick(squirrel) {
        console.log('[面板松鼠] 点击事件触发');

        // 如果正在说话，忽略
        if (squirrel.dataset.speaking === 'true') {
            console.log('[面板松鼠] 正在说话，忽略');
            return;
        }

        // 切换激活状态
        var isActive = squirrel.classList.toggle('active');
        console.log('[面板松鼠] 激活状态:', isActive, 'AI 已配置:', isConfigured);

        if (isActive) {
            // 激活后总是先移动+说话
            if (isConfigured) {
                panelSquirrelSpeak(squirrel, 'AI 助手已开启，正在分析终端输出...');
            } else {
                // 未配置 → 移动+说话后打开配置面板
                panelSquirrelSpeak(squirrel, '请先配置 AI 服务商信息');
                // 说完后打开配置面板
                setTimeout(function () {
                    openAiSettings(false);
                }, 3500);
            }
        } else {
            panelSquirrelSpeak(squirrel, 'AI 助手已关闭');
        }
    }

    // ========== 初始化 ==========
    updateModelOptions('dashscope');
    updateUiState();

    // 暴露配置给其他 JS 使用（供后续小松鼠功能调用）
    window.getAiConfig = function () {
        var provider = aiProviderSelect.value;
        return {
            provider: aiConfig.provider,
            apiKey: aiConfig.apiKey,
            model: (provider === 'custom') ? aiModelInput.value.trim() : aiConfig.model,
            customEndpoint: aiConfig.customEndpoint,
            isConfigured: isConfigured
        };
    };
})();
