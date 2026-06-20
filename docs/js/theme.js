/**
 * Nexus 主题管理模块 (theme.js)
 *
 * ================ 功能概述 ================
 * 1. 主题配置定义：6 种预设主题配色方案
 * 2. 主题切换功能：点击 UI 按钮切换主题
 * 3. 终端配色更新：xterm.js 终端颜色随主题变化
 * 4. 主题 UI 状态更新：下拉菜单选中状态同步
 *
 * ================ 技术要点 ================
 * - 主题数据保存在 localStorage 中，键名：'tview-theme'
 * - 通过给 document.documentElement 添加 CSS 类来切换主题
 * - xterm.js v5.x 使用 options.theme 对象设置终端配色
 * - 终端背景固定为黑色 (#000000)，确保代码显示一致性
 *
 * ================ 依赖关系 ================
 * - 依赖 main.js 中的 terminals 全局变量（终端实例数组）
 * - 依赖 session.js 中的 renderSessionList() 函数
 * - 依赖 CSS 变量 (--accent-color 等) 获取当前主题色
 */

// ==================== 主题配置 ====================
/**
 * 主题配置对象
 * 每个主题包含以下属性：
 * - name: 中文显示名称
 * - description: 主题风格描述
 * - cssClass: 应用到 documentElement 的 CSS 类名
 * - previewColor: 预览区域背景色（用于 UI 展示）
 * - textColor: 预览区域文字颜色
 * - icon: SVG 图标路径（用于主题切换按钮）
 */
const themeConfig = {
    // 暖阳主题：明亮清新，适合日间使用
    light: {
        name: '白色浅色',
        description: '明亮清新风格',
        cssClass: 'theme-light',
        previewColor: '#f5f5f5',
        textColor: '#333333',
        icon: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    },
    // 深蓝主题：专业沉稳，减少眼部疲劳
    deepblue: {
        name: '深蓝色调',
        description: '深蓝专业风格',
        cssClass: 'theme-deepblue',
        previewColor: '#0a1f3c',
        textColor: '#a8c5e8',
        icon: '<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>'
    },
    // 森林主题：黑客帝国风格，极客最爱
    green: {
        name: '绿色矩阵',
        description: '黑客帝国风格',
        cssClass: 'theme-green',
        previewColor: '#0d1a0d',
        textColor: '#8fbf8f',
        icon: '<path d="M12 3L9 9H5L7 15H4L12 21L20 15H17L19 9H15L12 3Z"/>'
    },
    // 樱花主题：柔和温馨，个性化选择
    pink: {
        name: '樱花粉柔',
        description: '浅粉色可爱风格',
        cssClass: 'theme-pink',
        previewColor: '#fff8fc',
        textColor: '#5a4a4a',
        icon: '<path d="M12 8.5c-1.5-2-3.5-2.5-5-1.5s-2 3-.5 5c-2 .5-3.5 2-3.5 4s2 3 4.5 3c2 0 3.5-1 4.5-2.5 1 1.5 2.5 2.5 4.5 2.5 2.5 0 4.5-1 4.5-3s-1.5-3.5-3.5-4c1.5-2 1-4-.5-5s-3.5-.5-5 1.5z"/>'
    },
    // 海洋主题：淡蓝清爽
    ocean: {
        name: '海洋',
        description: '淡蓝色海洋风格',
        cssClass: 'theme-ocean',
        previewColor: '#e8f4f8',
        textColor: '#2c5270',
        icon: '<path d="M12 2.69l5.66 5.66c2.64 2.64 2.64 6.93 0 9.57s-6.93 2.64-9.57 0-2.64-6.93 0-9.57L12 2.69M12 5.51L8.22 9.29c-1.53 1.53-1.53 4.02 0 5.55s4.02 1.53 5.55 0 1.53-4.02 0-5.55L12 5.51z"/>'
    },
    // 日落主题：橙色温暖
    sunset: {
        name: '日落',
        description: '橙色日落风格',
        cssClass: 'theme-sunset',
        previewColor: '#fff8f0',
        textColor: '#7c4a2e',
        icon: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>'
    }
};

// 当前应用的主题（运行时状态）
let currentTheme = 'light';

/**
 * 更新所有终端的配色以匹配当前主题
 *
 * ================ 实现原理 ================
 * 遍历 terminals 对象中的所有终端实例，
 * 调用 xterm.js 的 options.theme 属性更新配色。
 *
 * 注意：xterm.js v5.x 使用 options.theme 对象来设置主题，
 * 而不是早期的 css 变量方式。
 *
 * @function updateTerminalThemes
 * @requires terminals - 全局变量，存储所有终端实例
 * @requires getTerminalTheme() - 获取当前主题的终端配色配置
 */
function updateTerminalThemes() {
    console.log('[主题系统] 开始更新终端配色，当前主题:', currentTheme);

    // 获取当前主题的终端配色配置
    const terminalTheme = getTerminalTheme();
    console.log('[主题系统] 终端主题配置:', terminalTheme);

    // 遍历所有终端实例
    Object.values(terminals).forEach((term, index) => {
        // 跳过不存在的终端
        if (!term) {
            console.log('[主题系统] 终端', index, '不存在，跳过');
            return;
        }

        console.log('[主题系统] 正在更新终端', index, '的配色');

        // xterm.js v5.x 使用 options.theme 来设置主题
        term.options.theme = terminalTheme;

        console.log('[主题系统] 终端', index, '主题已设置');

        // 强制刷新终端以确保主题生效
        // refresh(rowStart, rowEnd) 强制重绘指定行范围
        setTimeout(() => {
            term.refresh(0, term.rows - 1);
            console.log('[主题系统] 终端', index, '配色更新完成');
        }, 50);
    });

    console.log('[主题系统] 所有终端更新指令已发送');
}

/**
 * 初始化主题系统
 *
 * ================ 初始化流程 ================
 * 1. 从 localStorage 读取用户上次选择的主题
 * 2. 如果已保存主题则应用，否则使用默认主题 (light)
 * 3. 绑定主题切换按钮的事件监听器
 *
 * @function initThemeSystem
 * @uses localStorage.getItem() - 读取保存的主题
 * @uses applyTheme() - 应用指定主题
 * @uses bindThemeEvents() - 绑定 UI 事件
 */
function initThemeSystem() {
    // 从 localStorage 获取用户保存的主题
    const savedTheme = localStorage.getItem('tview-theme');

    // 如果保存的主题有效则应用，否则使用默认主题 light
    if (savedTheme && themeConfig[savedTheme]) {
        applyTheme(savedTheme, false);
    } else {
        applyTheme('light', false);
    }

    // 绑定主题切换按钮事件（下拉菜单交互）
    bindThemeEvents();
}

/**
 * 应用主题
 *
 * ================ 执行步骤 ================
 * 1. 验证主题名称是否有效
 * 2. 更新 currentTheme 全局变量
 * 3. 移除 documentElement 上所有 theme-* 类
 * 4. 添加新主题的 CSS 类
 * 5. 可选：保存到 localStorage
 * 6. 更新 UI 状态（下拉菜单、按钮图标）
 * 7. 重新渲染会话列表（更新主题样式）
 * 8. 更新所有终端配色
 *
 * @function applyTheme
 * @param {string} themeName - 主题名称（必须是 themeConfig 中定义的键）
 * @param {boolean} save - 是否保存到 localStorage，默认 true
 */
function applyTheme(themeName, save = true) {
    // 验证主题是否存在
    if (!themeConfig[themeName]) {
        console.warn('未知的主题:', themeName);
        return;
    }

    // 更新全局状态
    currentTheme = themeName;

    // 移除所有主题类（兼容可能存在的多个主题类）
    document.documentElement.className = document.documentElement.className
        .split(' ')
        .filter(cls => !cls.startsWith('theme-'))  // 过滤掉所有 theme-开头的类
        .join(' ');

    // 添加新主题类到 documentElement
    // 这样 CSS 变量会随之改变，整个应用的主题色都会更新
    document.documentElement.classList.add(themeConfig[themeName].cssClass);

    // 保存到 localStorage（除非显式指定不保存）
    if (save) {
        localStorage.setItem('tview-theme', themeName);
    }

    // 更新 UI 状态：下拉菜单选中状态、按钮图标颜色
    updateThemeSwitcherUI(themeName);

    // 重新渲染会话列表以更新主题样式
    // 会话列表的背景色、文字颜色等会随主题变化
    renderSessionList();

    // 更新所有终端的配色
    updateTerminalThemes();
}

/**
 * 更新主题切换器 UI
 *
 * ================ 更新内容 ================
 * 1. 更新下拉菜单中各选项的选中状态（高亮背景 + 对勾标记）
 * 2. 更新顶部标题栏主题按钮的图标和颜色
 *
 * @function updateThemeSwitcherUI
 * @param {string} themeName - 当前主题名称
 */
function updateThemeSwitcherUI(themeName) {
    // 更新所有主题选项的选中状态
    Object.keys(themeConfig).forEach(key => {
        const option = document.querySelector(`.theme-option[data-theme="${key}"]`);
        const checkIcon = document.getElementById('theme-check-' + key);

        if (option && checkIcon) {
            if (key === themeName) {
                // 选中状态：添加绿色高亮背景，显示对勾图标
                option.classList.add('bg-green-50');
                checkIcon.classList.remove('hidden');
            } else {
                // 非选中状态：移除高亮背景，隐藏对勾图标
                option.classList.remove('bg-green-50');
                checkIcon.classList.add('hidden');
            }
        }
    });

    // 更新主题切换按钮的图标和颜色
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
        const svg = toggleBtn.querySelector('svg');
        if (svg && themeConfig[themeName].icon) {
            // 主题按钮颜色映射表
            const iconColors = {
                light: 'text-yellow-500',    // 暖阳 - 黄色
                deepblue: 'text-blue-600',   // 深蓝 - 蓝色
                green: 'text-green-600',     // 森林 - 绿色
                pink: 'text-pink-500',       // 樱花 - 粉色
                ocean: 'text-cyan-500',      // 海洋 - 青色
                sunset: 'text-orange-500'    // 日落 - 橙色
            };

            // 移除所有颜色类，保留基础类和过渡动画类
            svg.className = 'w-5 h-5 transition-colors ' + iconColors[themeName];

            // 更新 SVG 图标内容为当前主题的图标
            svg.innerHTML = themeConfig[themeName].icon;
        }
    }
}

/**
 * 计算对比度颜色
 *
 * ================ 算法说明 ================
 * 根据背景色的亮度决定使用深色还是浅色文字，
 * 以确保文字可读性（WCAG 对比度标准）。
 *
 * 亮度计算公式：(R * 299 + G * 587 + B * 114) / 1000
 * 这是 ITU-R BT.601 标准的亮度公式。
 *
 * @function getContrastColor
 * @param {string} bgColor - 背景颜色（十六进制格式，如 #ffffff）
 * @returns {string} 对比度颜色（#333333 或 #ffffff）
 */
function getContrastColor(bgColor) {
    // 将十六进制颜色转换为 RGB
    const r = parseInt(bgColor.substr(1, 2), 16);
    const g = parseInt(bgColor.substr(3, 2), 16);
    const b = parseInt(bgColor.substr(5, 2), 16);

    // 计算亮度（使用 ITU-R BT.601 标准公式）
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

    // 亮度高于 125 使用深色文字，否则使用浅色文字
    return brightness > 125 ? '#333333' : '#ffffff';
}

/**
 * 绑定主题切换事件
 *
 * ================ 事件绑定 ================
 * 1. 主题按钮点击：切换下拉菜单显示/隐藏
 * 2. 文档点击：点击其他区域时关闭下拉菜单
 * 3. 下拉菜单点击：阻止事件冒泡
 * 4. 主题选项点击：应用选中的主题并关闭菜单
 *
 * @function bindThemeEvents
 */
function bindThemeEvents() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    const themeDropdown = document.querySelector('.theme-dropdown');
    const themeOptions = document.querySelectorAll('.theme-option');

    // 切换按钮点击事件：显示/隐藏下拉菜单
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();  // 阻止事件冒泡到 document
        themeDropdown.classList.toggle('show');
    });

    // 点击其他区域关闭下拉菜单
    // 这是常见的下拉菜单交互模式
    document.addEventListener('click', (e) => {
        // 如果下拉菜单已经是隐藏状态，直接返回
        if (!themeDropdown.classList.contains('show')) return;

        // 如果点击的是下拉菜单外部，关闭菜单
        if (!themeDropdown.contains(e.target) && e.target !== toggleBtn) {
            themeDropdown.classList.remove('show');
        }
    });

    // 阻止下拉菜单区域点击事件冒泡
    // 这样点击菜单内部时不会触发 document 的点击事件
    themeDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // 为每个主题选项绑定点击事件
    themeOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            // 从 data-theme 属性获取主题名称
            const themeName = option.getAttribute('data-theme');

            // 验证主题是否存在并应用
            if (themeName && themeConfig[themeName]) {
                applyTheme(themeName);  // 应用主题
                themeDropdown.classList.remove('show');  // 关闭下拉菜单
            }
        });
    });
}

/**
 * 获取终端主题配色配置
 *
 * ================ 设计原则 ================
 * - 终端背景固定为黑色 (#000000)，确保代码显示一致性
 * - 文字前景色根据主题动态调整，保证在黑色背景上的可读性
 * - 16 色配置（8 种基础色 + 8 种亮色）完整覆盖 ANSI 颜色
 *
 * ================ 主题配色特点 ================
 * - light: 清新明亮，高饱和度
 * - pink: 柔和温馨，粉色调
 * - deepblue: 冷色调，专业感
 * - green: 黑客帝国风格，绿色主调
 * - high-contrast: 最高对比度，无障碍设计
 * - 默认：紫色调，神秘优雅
 *
 * @function getTerminalTheme
 * @returns {Object} xterm.js 主题配置对象
 */
function getTerminalTheme() {
    // 获取 document 根元素上的 CSS 变量
    const rootStyles = getComputedStyle(document.documentElement);
    const accentColor = rootStyles.getPropertyValue('--accent-color').trim();

    // 终端背景固定为黑色 #000000
    // 文字前景色根据主题调整以保持可读性
    let foregroundColor = '#ffffff';  // 默认白色
    let cursorColor = '#ffffff';      // 默认白色光标

    // 根据主题调整文字颜色
    if (currentTheme === 'light') {
        // 浅色主题使用浅灰色文字，在黑色背景上清晰可见
        foregroundColor = '#e0e0e0';
        cursorColor = '#e0e0e0';
    } else if (currentTheme === 'pink') {
        // 粉色主题使用柔和的粉紫色文字
        foregroundColor = '#e8b5d9';
        cursorColor = '#e8b5d9';
    } else if (currentTheme === 'deepblue') {
        // 深蓝主题使用浅蓝色文字
        foregroundColor = '#a8c5e8';
        cursorColor = '#a8c5e8';
    } else if (currentTheme === 'green') {
        // 绿色主题使用亮绿色文字（黑客帝国风格）
        foregroundColor = '#8fbf8f';
        cursorColor = '#8fbf8f';
    } else if (currentTheme === 'high-contrast') {
        // 高对比度主题使用纯白色文字
        foregroundColor = '#ffffff';
        cursorColor = '#ffffff';
    } else {
        // 其他主题使用白色
        foregroundColor = '#ffffff';
        cursorColor = '#ffffff';
    }

    // ==================== light 主题配色 ====================
    // 特点：清新明亮，适合日间使用
    if (currentTheme === 'light') {
        return {
            background: '#000000',  // 强制黑色背景
            foreground: foregroundColor,
            cursor: cursorColor,
            // ANSI 基础 8 色
            black: '#000000',
            red: '#ff6b6b',
            green: '#69db7c',
            yellow: '#ffe066',
            blue: '#74c0fc',
            magenta: '#da77f2',
            cyan: '#63e6be',
            white: '#e9ecef',
            // ANSI 亮 8 色
            brightBlack: '#868e96',
            brightRed: '#fa5252',
            brightGreen: '#51cf66',
            brightYellow: '#fcc419',
            brightBlue: '#339af0',
            brightMagenta: '#be4bdb',
            brightCyan: '#38d9a9',
            brightWhite: '#f8f9fa',
        };
    }

    // ==================== pink 主题配色 ====================
    // 特点：柔和温馨，粉色调
    if (currentTheme === 'pink') {
        return {
            background: '#000000',  // 强制黑色背景
            foreground: foregroundColor,
            cursor: cursorColor,
            // ANSI 基础 8 色
            black: '#f8e1e7',
            red: '#e57373',
            green: '#a5d6a7',
            yellow: '#fff59d',
            blue: '#90caf9',
            magenta: '#ce93d8',
            cyan: '#80cbc4',
            white: '#f5f5f5',
            // ANSI 亮 8 色
            brightBlack: '#f0c5c5',
            brightRed: '#ef5350',
            brightGreen: '#66bb6a',
            brightYellow: '#ffeb3b',
            brightBlue: '#42a5f5',
            brightMagenta: '#ab47bc',
            brightCyan: '#26a69a',
            brightWhite: '#e0e0e0',
        };
    }

    // ==================== deepblue 主题配色 ====================
    // 特点：冷色调，专业感
    if (currentTheme === 'deepblue') {
        return {
            background: '#000000',  // 强制黑色背景
            foreground: foregroundColor,
            cursor: cursorColor,
            // ANSI 基础 8 色
            black: '#1a3a5c',
            red: '#ff6b8a',
            green: '#6ecb9a',
            yellow: '#ffd966',
            blue: '#6fa8dc',
            magenta: '#c58ad6',
            cyan: '#6dc5c5',
            white: '#c5d5e5',
            // ANSI 亮 8 色
            brightBlack: '#2a4a6c',
            brightRed: '#ff8ba8',
            brightGreen: '#8eebba',
            brightYellow: '#ffe986',
            brightBlue: '#8fc8fc',
            brightMagenta: '#d5aaf6',
            brightCyan: '#8de5e5',
            brightWhite: '#e5f0f8',
        };
    }

    // ==================== green 主题配色 ====================
    // 特点：黑客帝国风格，绿色主调
    if (currentTheme === 'green') {
        return {
            background: '#000000',  // 强制黑色背景
            foreground: foregroundColor,
            cursor: cursorColor,
            // ANSI 基础 8 色
            black: '#1a2a1a',
            red: '#ff6b6b',
            green: '#69db7c',
            yellow: '#ffd43b',
            blue: '#748ffc',
            magenta: '#da77f2',
            cyan: '#63e6be',
            white: '#c1e1c1',
            // ANSI 亮 8 色
            brightBlack: '#2a3a2a',
            brightRed: '#ff8787',
            brightGreen: '#8ce99a',
            brightYellow: '#ffe066',
            brightBlue: '#91a7ff',
            brightMagenta: '#e599f7',
            brightCyan: '#84fab0',
            brightWhite: '#e0f0e0',
        };
    }

    // ==================== high-contrast 主题配色 ====================
    // 特点：最高对比度，无障碍设计
    if (currentTheme === 'high-contrast') {
        return {
            background: '#000000',  // 强制黑色背景
            foreground: foregroundColor,
            cursor: cursorColor,
            // ANSI 基础 8 色（纯色）
            black: '#000000',
            red: '#ff0000',
            green: '#00ff00',
            yellow: '#ffff00',
            blue: '#0080ff',
            magenta: '#ff00ff',
            cyan: '#00ffff',
            white: '#ffffff',
            // ANSI 亮 8 色
            brightBlack: '#666666',
            brightRed: '#ff3333',
            brightGreen: '#33ff33',
            brightYellow: '#ffff33',
            brightBlue: '#33a0ff',
            brightMagenta: '#ff33ff',
            brightCyan: '#33ffff',
            brightWhite: '#ffffff',
        };
    }

    // ==================== 默认主题配色（purple） ====================
    // 特点：紫色调，神秘优雅
    return {
        background: '#000000',  // 强制黑色背景
        foreground: foregroundColor,
        cursor: cursorColor,
        // ANSI 基础 8 色
        black: '#2a1a3a',
        red: '#ff6b9d',
        green: '#6ecb9a',
        yellow: '#ffd966',
        blue: '#7fa8e6',
        magenta: '#c58ad6',
        cyan: '#6dc5d6',
        white: '#d5c5e5',
        // ANSI 亮 8 色
        brightBlack: '#3a2a4a',
        brightRed: '#ff8bbd',
        brightGreen: '#8eebba',
        brightYellow: '#ffe986',
        brightBlue: '#9fc8f6',
        brightMagenta: '#d5aaf6',
        brightCyan: '#8de5f5',
        brightWhite: '#f0e8f8',
    };
}

/**
 * 初始化所有终端实例
 *
 * ================ 初始化流程 ================
 * 1. 定义要初始化的终端面板 ID 列表
 * 2. 遍历 ID，为每个面板创建 Terminal 实例
 * 3. 应用当前主题配色
 * 4. 写入欢迎信息
 * 5. 绑定终端输入事件（onData）
 *
 * ================ 终端配置说明 ================
 * - fontFamily: 优先使用 Fira Code（等宽连字字体）
 * - fontSize: 14px 适合大部分场景
 * - lineHeight: 1.2 倍行高，保证可读性
 * - cursorBlink: 光标闪烁，类似系统终端
 * - cursorStyle: block 块状光标
 *
 * @function initTerminals
 * @uses getTerminalTheme() - 获取终端配色
 * @uses terminals - 全局变量，存储终端实例
 */
function initTerminals() {
    // 定义要初始化的终端面板 ID 列表
    // 这些 ID 对应 HTML 中的终端容器元素
    const panelIds = ['terminal1', 'terminal2', 'terminal3', 'terminal4'];

    // 遍历所有面板 ID
    panelIds.forEach((id, index) => {
        const element = document.getElementById(id);

        // 只初始化还没有实例的终端（避免重复初始化）
        if (element && !terminals[id]) {
            // 创建 Terminal 实例
            const term = new Terminal({
                fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
                fontSize: 14,
                lineHeight: 1.2,
                cursorBlink: true,
                cursorStyle: 'block'
            });

            // 将终端绑定到 DOM 元素
            term.open(element);

            // 设置主题配色（xterm.js v5.x 使用 options.theme）
            term.options.theme = getTerminalTheme();

            // 聚焦终端以接收输入
            term.focus();

            // 保存终端实例到全局变量
            terminals[id] = term;

            // 写入欢迎信息
            // 使用 ANSI 转义序列设置颜色：\x1b[32m 绿色，\x1b[0m 重置
            const welcomeMessage = [
                '\x1b[32m欢迎使用 Nexus\x1b[0m',
                '\x1b[36mTerminal Version:\x1b[0m ' + term.rows + 'x' + term.cols,
                '\x1b[36mShell:\x1b[0m bash 5.1.8',
                '\x1b[36mWorking Directory:\x1b[0m ~',
                '\x1b[36mConnected to:\x1b[0m localhost',
                '',
                '\x1b[33m提示:\x1b[0m 这是一个模拟的终端，可用于输入命令',
                '输入 \x1b[32mclear\x1b[0m 清屏，输入 \x1b[32mhelp\x1b[0m 查看帮助',
                '',
            ];

            term.write(welcomeMessage.join('\r\n') + '\r\n');

            // 终端输入处理：监听用户输入
            term.onData((data) => {
                // 回显用户输入
                term.write('\r\n' + data);

                // 简单命令处理
                if (data === 'clear\n' || data === 'cls\n') {
                    // 清屏命令
                    term.clear();
                } else if (data === 'help\n') {
                    // 帮助命令
                    term.write('\r\n\x1b[32m 可用命令:\x1b[0m');
                    term.write('\r\n  clear   - 清除屏幕');
                    term.write('\r\n  help    - 显示帮助');
                    term.write('\r\n  ls      - 列出目录');
                    term.write('\r\n  pwd     - 显示当前目录');
                    term.write('\r\n  date    - 显示日期');
                    term.write('\r\n');
                } else if (data === 'ls\n') {
                    // ls 命令：模拟列出目录
                    term.write('\r\n\x1b[36mDesktop\x1b[0m   \x1b[34mDocuments\x1b[0m   \x1b[34mDownloads\x1b[0m   \x1b[34mProjects\x1b[0m\r\n');
                } else if (data === 'pwd\n') {
                    // pwd 命令：显示当前目录
                    term.write('\r\n\x1b[36m~\x1b[0m\r\n');
                } else if (data === 'date\n') {
                    // date 命令：显示日期
                    term.write('\r\n' + new Date().toString() + '\r\n');
                }
            });
        }
    });
}
