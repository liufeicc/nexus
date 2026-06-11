using System.Collections.Generic;
using System.Linq;
using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Mothership;

/// <summary>
/// 炮塔插槽管理器 — 管理母舰上的 12 个炮塔插槽。
/// 空位显示灰色方块，点击后弹出选择菜单，选择炮塔类型并扣除资源后安装。
/// 作为母舰子节点挂载，负责在指定位置安装/卸载炮塔。
/// 注意：必须在 Mothership.tscn 中排在 MainCannon 之前，
/// 这样 _Input 先处理，才能拦截空位点击事件。
/// </summary>
public partial class TurretSlotManager : Node2D
{
    // ─────────── 配置参数 ───────────

    /// <summary>
    /// 12 个炮塔插槽的初始配置数组（使用 int 存储，0=None, 1=Bullet, 2=Shotgun, 3=Missile, 4=Laser）。
    /// Godot 4 C# 不支持导出枚举数组，因此使用 int[] 并在代码中转换。
    /// 在 Godot Inspector 中可以配置每个插槽的初始炮塔类型。
    /// </summary>
    [Export]
    public int[] SlotTypes { get; set; } = new int[SlotCount];

    // ─────────── 插槽位置定义 ───────────

    /// <summary>12 个插槽的相对位置（相对于母舰中心）</summary>
    private static readonly Vector2[] SlotPositions = new Vector2[]
    {
        new(400, -100),    // 0: 船头上方
        new(440, 0),       // 1: 船头中央
        new(400, 100),     // 2: 船头下方
        new(200, -160),    // 3: 上半前
        new(-100, -160),   // 4: 上半后
        new(200, 160),     // 5: 下半前
        new(-100, 160),    // 6: 下半后
        new(-350, -80),    // 7: 船尾上
        new(-350, 80),     // 8: 船尾下
        new(100, 200),     // 9: 底部前
        new(0, 210),       // 10: 底部中
        new(-100, 200),    // 11: 底部后
    };

    /// <summary>4 个机库插槽的相对位置（相对于母舰中心，后部）</summary>
    private static readonly Vector2[] HangarPositions = new Vector2[]
    {
        new(-350, -120),   // 机库0：船尾左上
        new(-350, 120),    // 机库1：船尾左下
        new(-420, -120),   // 机库2：船尾右上（更靠后）
        new(-420, 120),    // 机库3：船尾右下（更靠后）
    };

    /// <summary>插槽数量</summary>
    public const int SlotCount = 12;

    /// <summary>机库插槽数量</summary>
    public const int HangarSlotCount = 4;

    /// <summary>机库建造费用</summary>
    public const int HangarBuildCost = 300;

    // ─────────── 炮塔费用 ───────────

    /// <summary>各类型炮塔的安装费用</summary>
    private static readonly Dictionary<Weapon.TurretType, int> TurretCosts = new()
    {
        { Weapon.TurretType.Bullet,  100 },
        { Weapon.TurretType.Shotgun, 200 },
        { Weapon.TurretType.Missile, 300 },
        { Weapon.TurretType.Laser,   400 },
    };

    /// <summary>
    /// 获取指定炮塔类型的安装费用
    /// </summary>
    public static int GetTurretCost(Weapon.TurretType type)
    {
        return TurretCosts.TryGetValue(type, out int cost) ? cost : 0;
    }

    // ─────────── 内部状态 ───────────

    /// <summary>已安装的炮塔数组（null 表示空插槽）</summary>
    private Weapon.TurretBase[] _installedTurrets = new Weapon.TurretBase[SlotCount];

    /// <summary>空位视觉节点数组</summary>
    private TurretSlotVisual[] _slotVisuals = new TurretSlotVisual[SlotCount];

    /// <summary>炮塔选择菜单</summary>
    private TurretMenu _turretMenu;

    /// <summary>当前菜单对应的插槽索引（-1 表示无菜单）</summary>
    private int _menuSlotIndex = -1;

    /// <summary>已安装的机库数组（null 表示空插槽）</summary>
    private HangarBay[] _installedHangars = new HangarBay[HangarSlotCount];

    /// <summary>机库空位视觉节点数组</summary>
    private TurretSlotVisual[] _hangarVisuals = new TurretSlotVisual[HangarSlotCount];

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        // 确保 SlotTypes 数组长度正确（Godot Inspector 可能修改了长度）
        if (SlotTypes == null || SlotTypes.Length != SlotCount)
        {
            GD.PrintErr($"[TurretSlotManager] SlotTypes 数组长度应为 {SlotCount}，已重置");
            SlotTypes = new int[SlotCount];
        }

        // 创建所有插槽视觉 + 安装默认炮塔
        for (int i = 0; i < SlotCount; i++)
        {
            // 创建空位视觉（灰色方块 + 加号）
            var visual = new TurretSlotVisual();
            visual.Name = $"SlotVisual_{i}";
            visual.Position = SlotPositions[i];
            visual.SlotIndex = i;
            AddChild(visual);
            _slotVisuals[i] = visual;

            // 将 int 转换为枚举类型
            var turretType = (Weapon.TurretType)SlotTypes[i];

            // 安装默认炮塔（非 None 的插槽）
            if (turretType != Weapon.TurretType.None)
            {
                InstallTurret(i, turretType);
                visual.SetSlotVisible(false);  // 有炮塔时隐藏空位标记
            }
        }

        // 创建炮塔选择菜单（CanvasLayer，独立于场景层级）
        _turretMenu = new TurretMenu();
        _turretMenu.Name = "TurretMenu";
        AddChild(_turretMenu);
        _turretMenu.TurretSelected += OnTurretSelected;
        _turretMenu.MenuClosed += OnMenuClosed;

        // ─── 机库插槽初始化 ───
        for (int i = 0; i < HangarSlotCount; i++)
        {
            var visual = new TurretSlotVisual();
            visual.Name = $"HangarVisual_{i}";
            visual.Position = HangarPositions[i];
            visual.SlotIndex = 100 + i;  // 机库插槽索引从 100 开始
            AddChild(visual);
            _hangarVisuals[i] = visual;
        }

        int installedCount = _installedTurrets.Count(t => t != null);
        int emptyCount = SlotCount - installedCount;
        GD.Print($"[TurretSlotManager] 初始化完成，{installedCount} 个炮塔已安装，{emptyCount} 个空位");
    }

    public override void _Input(InputEvent @event)
    {
        // 菜单已打开时，Esc 关闭菜单，左键由菜单自行处理
        if (_turretMenu != null && _turretMenu.Visible)
        {
            if (@event is InputEventKey key && key.Pressed && key.Keycode == Key.Escape)
            {
                _turretMenu.HideMenu();
                GetViewport().SetInputAsHandled();
            }
            return;
        }

        // 仅处理鼠标左键按下事件
        if (@event is not InputEventMouseButton mb) return;
        if (mb.ButtonIndex != MouseButton.Left || !mb.Pressed) return;

        // 获取鼠标世界坐标
        Vector2 mouseWorldPos = GetGlobalMousePosition();

        // 遍历所有空位，检测是否点击到空位
        for (int i = 0; i < SlotCount; i++)
        {
            // 跳过已有炮塔的插槽
            if (_installedTurrets[i] != null) continue;
            if (_slotVisuals[i] == null || !_slotVisuals[i].Visible) continue;

            // 检测点击位置是否在空位范围内
            if (_slotVisuals[i].ContainsWorldPoint(mouseWorldPos))
            {
                OpenSlotMenu(i);
                // 消费此事件，防止 MainCannon 处理
                GetViewport().SetInputAsHandled();
                return;
            }
        }

        // ─── 检测机库空位点击 ───
        for (int i = 0; i < HangarSlotCount; i++)
        {
            if (_installedHangars[i] != null) continue;
            if (_hangarVisuals[i] == null || !_hangarVisuals[i].Visible) continue;

            if (_hangarVisuals[i].ContainsWorldPoint(mouseWorldPos))
            {
                BuildHangar(i);
                GetViewport().SetInputAsHandled();
                return;
            }
        }
    }

    // ─────────── 菜单交互 ───────────

    /// <summary>
    /// 打开指定插槽的炮塔选择菜单
    /// </summary>
    private void OpenSlotMenu(int slotIndex)
    {
        _menuSlotIndex = slotIndex;

        // 将插槽世界坐标转换为屏幕坐标，定位菜单
        Vector2 slotWorldPos = _slotVisuals[slotIndex].GlobalPosition;
        var canvasTransform = GetViewport().GetCanvasTransform();
        Vector2 screenPos = canvasTransform * slotWorldPos;

        // 菜单显示在插槽右侧偏移位置
        screenPos += new Vector2(60, -20);

        _turretMenu.ShowMenu(screenPos);
    }

    /// <summary>
    /// 菜单选择回调 — 扣除资源并安装炮塔
    /// </summary>
    private void OnTurretSelected(int typeValue)
    {
        var type = (Weapon.TurretType)typeValue;

        if (_menuSlotIndex < 0 || _menuSlotIndex >= SlotCount) return;

        // 安全检查：该插槽已有炮塔
        if (_installedTurrets[_menuSlotIndex] != null) return;

        int cost = GetTurretCost(type);

        // 扣除资源，不足时提示并取消
        if (ResourceManager.Instance == null || !ResourceManager.Instance.TrySpend(cost))
        {
            GD.Print($"[TurretSlotManager] 资源不足！需要 {cost}，当前 {ResourceManager.Instance?.CurrentResources ?? 0}");
            _menuSlotIndex = -1;
            return;
        }

        // 安装炮塔
        InstallTurret(_menuSlotIndex, type);

        // 隐藏空位标记
        _slotVisuals[_menuSlotIndex].SetSlotVisible(false);

        GD.Print($"[TurretSlotManager] 安装 {type} 到插槽 {_menuSlotIndex}，花费 {cost} 资源");
        _menuSlotIndex = -1;
    }

    /// <summary>
    /// 菜单关闭回调 — 清理菜单状态
    /// </summary>
    private void OnMenuClosed()
    {
        _menuSlotIndex = -1;
    }

    // ─────────── 公共方法 ───────────

    /// <summary>
    /// 在指定插槽安装炮塔。
    /// 在 AddChild 之前设置 SlotIndex，确保炮塔 _Ready 时已知自己的位置。
    /// 连接 TurretDied 信号，以便炮塔被摧毁时自动清理插槽。
    /// </summary>
    public void InstallTurret(int slotIndex, Weapon.TurretType type)
    {
        if (slotIndex < 0 || slotIndex >= SlotCount)
        {
            GD.PrintErr($"[TurretSlotManager] 插槽索引无效: {slotIndex}");
            return;
        }

        // 如果已有炮塔，先卸载
        if (_installedTurrets[slotIndex] != null)
        {
            UninstallTurret(slotIndex);
        }

        // 创建炮塔实例
        var turret = CreateTurretInstance(type);
        if (turret == null)
        {
            GD.PrintErr($"[TurretSlotManager] 无法创建炮塔类型: {type}");
            return;
        }

        // 设置插槽索引（必须在 AddChild 之前，因为 AddChild 会触发 _Ready）
        turret.SlotIndex = slotIndex;

        // 设置位置并添加到场景（触发 _Ready）
        turret.Position = SlotPositions[slotIndex];
        AddChild(turret);
        _installedTurrets[slotIndex] = turret;

        // 连接死亡信号 — 炮塔被摧毁时清理插槽
        turret.TurretDied += OnTurretDestroyed;
    }

    /// <summary>
    /// 卸载指定插槽的炮塔
    /// </summary>
    public void UninstallTurret(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= SlotCount) return;

        var turret = _installedTurrets[slotIndex];
        if (turret != null && IsInstanceValid(turret))
        {
            // 断开信号避免悬挂引用
            turret.TurretDied -= OnTurretDestroyed;
            turret.QueueFree();
        }
        _installedTurrets[slotIndex] = null;
    }

    /// <summary>
    /// 炮塔被摧毁时的回调（由 TurretDied 信号触发）。
    /// 清理插槽引用，恢复灰色空位视觉，允许玩家花资源重建。
    /// </summary>
    private void OnTurretDestroyed(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= SlotCount) return;

        _installedTurrets[slotIndex] = null;

        // 恢复空位视觉（灰色方块 + 加号），允许重建
        if (_slotVisuals[slotIndex] != null)
        {
            _slotVisuals[slotIndex].SetSlotVisible(true);
        }

        GD.Print($"[TurretSlotManager] 插槽 {slotIndex} 的炮塔被摧毁，空位已恢复");
    }

    /// <summary>
    /// 获取指定插槽的炮塔（可能为 null 或已被摧毁）
    /// </summary>
    public Weapon.TurretBase GetTurret(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= SlotCount) return null;
        var turret = _installedTurrets[slotIndex];
        // 检查炮塔是否仍有效（可能已被摧毁）
        if (turret != null && !IsInstanceValid(turret))
        {
            _installedTurrets[slotIndex] = null;
        }
        return _installedTurrets[slotIndex];
    }

    /// <summary>
    /// 获取所有已安装的炮塔
    /// </summary>
    public IEnumerable<Weapon.TurretBase> GetAllTurrets()
    {
        return _installedTurrets.Where(t => t != null && IsInstanceValid(t));
    }

    /// <summary>
    /// 获取所有存活的炮塔（已安装、实例有效、未死亡）。
    /// 供 EnemyFighterAI 在母舰内部寻找炮塔目标使用。
    /// </summary>
    public IEnumerable<Weapon.TurretBase> GetAllAliveTurrets()
    {
        return _installedTurrets.Where(t =>
        {
            if (t == null || !IsInstanceValid(t)) return false;
            var health = t.GetNodeOrNull<HealthComponent>("HealthComponent");
            return health != null && !health.IsDead;
        });
    }

    // ─────────── 私有方法 ───────────

    /// <summary>
    /// 根据类型创建炮塔实例（直接 new，不使用场景文件）
    /// </summary>
    private Weapon.TurretBase CreateTurretInstance(Weapon.TurretType type)
    {
        return type switch
        {
            Weapon.TurretType.Bullet => new Weapon.BulletTurret(),
            Weapon.TurretType.Shotgun => new Weapon.ShotgunTurret(),
            Weapon.TurretType.Missile => new Weapon.MissileTurret(),
            Weapon.TurretType.Laser => new Weapon.LaserTurret(),
            _ => null
        };
    }

    // ─────────── 机库交互 ───────────

    /// <summary>
    /// 建造机库 — 扣除资源并安装
    /// </summary>
    public void BuildHangar(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= HangarSlotCount) return;
        if (_installedHangars[slotIndex] != null) return;

        // 扣除资源
        if (ResourceManager.Instance == null || !ResourceManager.Instance.TrySpend(HangarBuildCost))
        {
            GD.Print($"[TurretSlotManager] 资源不足！建造机库需要 {HangarBuildCost}");
            return;
        }

        // 创建机库实例
        var hangar = new HangarBay();
        hangar.Name = $"HangarBay_{slotIndex}";
        hangar.SlotIndex = slotIndex;
        hangar.Position = HangarPositions[slotIndex];
        AddChild(hangar);
        _installedHangars[slotIndex] = hangar;

        // 连接死亡信号
        hangar.HangarDied += OnHangarDestroyed;

        // 建造
        hangar.Build();

        // 隐藏空位标记
        if (_hangarVisuals[slotIndex] != null)
        {
            _hangarVisuals[slotIndex].SetSlotVisible(false);
        }

        GD.Print($"[TurretSlotManager] 建造机库到插槽 {slotIndex}，花费 {HangarBuildCost} 资源");
    }

    /// <summary>
    /// 机库被摧毁时的回调
    /// </summary>
    private void OnHangarDestroyed(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= HangarSlotCount) return;

        _installedHangars[slotIndex] = null;

        if (_hangarVisuals[slotIndex] != null)
        {
            _hangarVisuals[slotIndex].SetSlotVisible(true);
        }

        GD.Print($"[TurretSlotManager] 机库 {slotIndex} 被摧毁，空位已恢复");
    }

    /// <summary>
    /// 召回所有机库的战斗机（波次结束时使用）
    /// </summary>
    public void RecallAllFighters()
    {
        foreach (var hangar in _installedHangars)
        {
            hangar?.RecallAll();
        }
    }

    /// <summary>
    /// 获取所有存活的机库
    /// </summary>
    public IEnumerable<HangarBay> GetAllHangars()
    {
        return _installedHangars.Where(h => h != null && IsInstanceValid(h));
    }
}
