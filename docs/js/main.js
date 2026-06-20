/**
 * Nexus 终端复用工具 - 主入口文件 (main.js)
 *
 * ================ 文件概述 ================
 * 本文件是应用的主入口，负责：
 * 1. 定义全局变量和配置
 * 2. 初始化各个模块（主题、终端、侧边栏等）
 * 3. 处理窗口大小调整
 * 4. 监听系统主题变化
 *
 * ================ 模块加载顺序 ================
 * 在 main.html 中，脚本按以下顺序加载：
 * 1. theme.js      - 主题管理（必须先加载，被其他模块依赖）
 * 2. modal.js      - 模态窗口管理
 * 3. session.js    - 会话管理
 * 4. panel.js      - 面板管理
 * 5. contextmenu.js- 右键菜单
 * 6. main.js       - 本文件（最后加载，因为它依赖以上所有模块）
 *
 * ================ 全局变量说明 ================
 * - terminals:  终端实例对象，键为面板 ID，值为 Terminal 实例
 * - config:     应用配置对象（常用路径等）
 */

// ==================== 常用路径配置 ====================
/**
 * 应用配置对象
 * commonPaths: 路径选择对话框中显示的常用路径列表
 *
 * 路径说明:
 * - name: 显示名称
 * - path: 实际路径（~表示主目录）
 * - icon: 图标 emoji
 *
 * 开发者可以在这里添加或修改常用路径
 */
const config = {
    commonPaths: [
        { name: '主目录', path: '~', icon: '🏠' },
        { name: '项目目录', path: '~/projects', icon: '📁' },
        { name: '下载', path: '~/Downloads', icon: '📁' },
        { name: '临时', path: '/tmp', icon: '📁' }
    ]
};

// ==================== 全局变量 ====================
/**
 * 终端实例对象
 * 存储所有已创建的终端实例，键为面板 ID，值为 xterm.js 的 Terminal 实例
 *
 * 使用示例:
 * const term = terminals['terminal1'];
 * term.write('Hello World');
 */
const terminals = {};

/**
 * 当前聚焦的面板 ID
 * 用于跟踪用户最后点击的面板，以便执行关闭、分割等操作
 * 当用户点击某个面板时，该变量会被更新
 */
let focusedPanelId = null;

// ==================== 侧边栏拖拽调整 - 状态变量 ====================
/**
 * 是否正在调整侧边栏宽度
 * 拖拽过程中为 true，用于阻止其他交互
 */
let isResizing = false;

/**
 * 侧边栏是否已收起
 * true: 收起状态，侧边栏隐藏
 * false: 展开状态，侧边栏显示
 */
let isSidebarCollapsed = false;

/**
 * 侧边栏当前宽度（像素）
 * 默认 224px (Tailwind 的 w-56)
 */
let sidebarWidth = 224;

/**
 * 侧边栏最小宽度
 * 拖拽时不能小于此值，确保可用性
 */
const MIN_SIDEBAR_WIDTH = 200;

/**
 * 侧边栏最大宽度
 * 拖拽时不能大于此值，确保主区域有足够空间
 */
const MAX_SIDEBAR_WIDTH = 600;

/**
 * 拖拽鼠标移动事件处理函数引用
 * 保存引用以便在 mouseup 时移除监听器
 */
let resizeMouseMoveHandler = null;

/**
 * 拖拽鼠标释放事件处理函数引用
 * 保存引用以便在 mouseup 时移除监听器
 */
let resizeMouseUpHandler = null;

/**
 * 初始化侧边栏拖拽功能
 *
 * ================ 实现原理 ================
 * 1. 获取 DOM 元素（分割线、侧边栏、收起按钮）
 * 2. 从 localStorage 恢复上次的宽度和收起/展开状态
 * 3. 绑定 mousedown 事件到分割线，启动拖拽
 * 4. 在 document 上绑定 mousemove 和 mouseup 事件
 * 5. 拖拽时动态更新侧边栏宽度
 * 6. 释放时保存宽度到 localStorage
 *
 * ================ 事件流程 ================
 * mousedown (resizer) → mousemove (document) → mouseup (document)
 *     ↓                      ↓                       ↓
 *   记录起始位置          计算新宽度              保存状态
 *   设置 cursor           更新宽度                清理监听器
 *
 * @function initSidebarResizer
 * @uses localStorage.getItem() - 恢复保存的状态
 * @uses localStorage.setItem() - 保存新的宽度
 */
function initSidebarResizer() {
    // 获取 DOM 元素
    const resizer = document.getElementById('sidebar-resizer');  // 分割线
    const sidebar = document.getElementById('sidebar');          // 侧边栏
    const toggleBtn = document.getElementById('sidebar-toggle-btn');  // 收起按钮

    // 如果元素不存在，直接返回（容错处理）
    if (!resizer || !sidebar) return;

    // ==================== 从 localStorage 恢复状态 ====================
    const savedWidth = localStorage.getItem('tview-sidebar-width');
    const savedCollapsed = localStorage.getItem('tview-sidebar-collapsed');

    // 恢复侧边栏收起/展开状态
    if (savedCollapsed === 'true') {
        // 收起状态
        sidebar.classList.add('sidebar-collapsed');
        isSidebarCollapsed = true;
        // 箭头向左（旋转 180 度）
        if (toggleBtn) {
            toggleBtn.querySelector('svg').style.transform = 'rotate(180deg)';
        }
    } else {
        // 展开状态
        // 恢复保存的宽度
        if (savedWidth) {
            sidebarWidth = parseInt(savedWidth, 10);
            sidebar.style.width = sidebarWidth + 'px';
        }
    }

    // ==================== 拖拽相关变量 ====================
    let startX = 0;     // 鼠标按下时的 X 坐标
    let startWidth = 0; // 侧边栏的初始宽度

    // ==================== 鼠标按下开始拖拽 ====================
    resizer.addEventListener('mousedown', function(e) {
        // 如果点击的是收起按钮，不启动拖拽（让按钮的点击事件处理）
        if (e.target.closest('.sidebar-toggle-btn')) return;

        e.preventDefault();  // 阻止默认行为（如文本选择）
        isResizing = true;   // 标记正在拖拽

        // 添加拖拽中的样式类（禁止过渡动画，提高跟手性）
        resizer.classList.add('resizing');
        sidebar.classList.add('resizing');

        // 记录起始位置和宽度
        startX = e.pageX;
        startWidth = sidebar.offsetWidth;

        // 设置鼠标样式为左右箭头
        document.body.style.cursor = 'col-resize';
        // 禁止文本选择，防止拖拽时选中文字
        document.body.style.userSelect = 'none';

        // ==================== 定义鼠标移动处理函数 ====================
        resizeMouseMoveHandler = function(e) {
            // 计算鼠标移动的距离
            const deltaX = e.pageX - startX;
            // 计算新宽度
            let newWidth = startWidth + deltaX;

            // 限制最小和最大宽度
            newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));

            // 应用新宽度
            sidebar.style.width = newWidth + 'px';
            sidebarWidth = newWidth;
        };

        // ==================== 定义鼠标释放处理函数 ====================
        resizeMouseUpHandler = function() {
            // 结束拖拽状态
            isResizing = false;

            // 移除拖拽样式类
            resizer.classList.remove('resizing');
            sidebar.classList.remove('resizing');

            // 恢复鼠标样式和文本选择
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // 移除事件监听（清理）
            document.removeEventListener('mousemove', resizeMouseMoveHandler);
            document.removeEventListener('mouseup', resizeMouseUpHandler);

            // 保存宽度到 localStorage，下次打开时恢复
            localStorage.setItem('tview-sidebar-width', sidebarWidth.toString());
        };

        // ==================== 添加事件监听 ====================
        // 注意：监听器绑定在 document 上，而不是 resizer 上
        // 这样即使鼠标快速移动移出 resizer 区域，拖拽仍然有效
        document.addEventListener('mousemove', resizeMouseMoveHandler);
        document.addEventListener('mouseup', resizeMouseUpHandler);
    });

    // ==================== 收起/展开按钮点击事件 ====================
    // 使用 click 事件，与 mousedown 不冲突
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();  // 阻止事件冒泡，避免触发其他点击事件

            // 切换收起/展开状态
            isSidebarCollapsed = !isSidebarCollapsed;

            if (isSidebarCollapsed) {
                // 收起侧边栏
                sidebar.classList.add('sidebar-collapsed');
                // 箭头向左（180 度）
                toggleBtn.querySelector('svg').style.transform = 'rotate(180deg)';
            } else {
                // 展开侧边栏
                sidebar.classList.remove('sidebar-collapsed');
                // 箭头向右（0 度）
                toggleBtn.querySelector('svg').style.transform = 'rotate(0deg)';
            }

            // 保存状态到 localStorage，下次打开时恢复
            localStorage.setItem('tview-sidebar-collapsed', isSidebarCollapsed.toString());
        });
    }
}

/**
 * DOM 加载完成后初始化
 *
 * ================ 事件触发时机 ================
 * DOMContentLoaded 在 HTML 文档完全加载和解析后触发，
 * 不需要等待 CSS 加载完成或图片加载完成。
 *
 * ================ 初始化顺序 ================
 * 1. initThemeSystem()    - 主题系统（最优先，影响其他组件样式）
 * 2. initTerminals()      - 终端初始化
 * 3. initSidebarResizer() - 侧边栏拖拽
 * 4. renderSessionList()  - 渲染会话列表
 * 5. bindSessionEvents()  - 绑定会话事件
 * 6. bindModalEvents()    - 绑定模态窗口事件
 * 7. bindContextMenuEvents() - 绑定右键菜单事件
 * 8. bindPanelEvents()    - 绑定面板事件
 * 9. bindToolbarButtonEvents() - 绑定工具栏按钮事件
 * 10. focusPanel()        - 聚焦第一个面板
 *
 * ================ 延迟执行说明 ================
 * - focusPanel 延迟 100ms 执行，确保终端已完全渲染
 *
 * @event DOMContentLoaded
 */
window.addEventListener('DOMContentLoaded', () => {
    // ==================== 初始化各个模块 ====================

    // 1. 初始化主题系统
    // 必须最先执行，因为其他组件可能依赖主题颜色
    initThemeSystem();

    // 2. 初始化终端
    // 创建 Terminal 实例，应用主题配色，写入欢迎信息
    initTerminals();

    // 3. 初始化侧边栏拖拽功能
    // 恢复侧边栏状态，绑定拖拽事件
    initSidebarResizer();

    // 4. 渲染会话列表
    // 从 localStorage 加载会话数据并渲染到 DOM
    renderSessionList();

    // 5. 绑定会话管理事件
    // 会话点击、新建、关闭、重命名等事件
    bindSessionEvents();

    // 6. 绑定模态窗口事件
    // 确认对话框、重命名对话框、路径选择器的确认/取消按钮
    bindModalEvents();

    // 7. 绑定右键菜单事件
    // 右键菜单项点击事件
    bindContextMenuEvents();

    // 8. 绑定面板事件
    // 面板点击、关闭、拖动等事件
    bindPanelEvents();

    // 9. 绑定工具栏按钮事件
    // 分割按钮、新建面板、关闭面板按钮
    bindToolbarButtonEvents();

    // ==================== 延迟聚焦第一个面板 ====================
    // 延迟 100ms 确保终端已完全渲染后再聚焦
    setTimeout(() => {
        focusPanel('terminal1');
    }, 100);

    // ==================== 窗口大小调整处理 ====================
    /**
     * 监听窗口 resize 事件，动态调整终端尺寸
     *
     * 原理：
     * 1. 获取终端容器的新尺寸
     * 2. 根据字体大小计算新的行列数
     * 3. 调用 term.resize() 调整终端
     */
    window.addEventListener('resize', () => {
        Object.values(terminals).forEach(term => {
            // 手动调整终端尺寸以适应容器
            if (term.element) {
                // 获取元素实际尺寸
                const rect = term.element.getBoundingClientRect();

                // 获取字体实际尺寸（从 xterm.js 内部属性）
                // _actualFontWidth: 每个字符的宽度（像素）
                // _actualFontHeight: 每行的高度（像素）
                const cols = Math.floor(rect.width / (term._core._renderService._renderer._actualFontWidth || 10));
                const rows = Math.floor(rect.height / (term._core._renderService._renderer._actualFontHeight || 20));

                // 如果行列数发生变化且有效，则调整
                if (cols > 0 && rows > 0 && (cols !== term.cols || rows !== term.rows)) {
                    term.resize(cols, rows);
                }
            }
        });
    });

    // ==================== 系统主题变化监听 ====================
    /**
     * 监听系统主题偏好变化（浅色/深色模式）
     * 当用户在操作系统中切换主题时，自动更新终端配色
     *
     * 注意：这是一个预留功能，目前主要由应用内主题切换控制
     */
    let resizeObserver;  // 预留变量（可能用于未来的 ResizeObserver）

    // 检查浏览器是否支持 matchMedia API
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')) {
        // 监听系统深色模式偏好变化
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        // 当系统主题变化时，更新终端配色
        mediaQuery.addEventListener('change', () => {
            updateTerminalThemes();
        });
    }
});
