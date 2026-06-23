using Godot;
using OtrasShip.AI;
using OtrasShip.Core;

namespace OtrasShip.Entity;

/// <summary>
/// 维修机器人实体 — 由维修平台生成，自动寻找受损目标并修复。
/// 继承 EntityBase，通过 RepairBotAI 状态机控制行为。
///
/// 特点：
///   - RepairBotAI 作为子节点，状态机驱动（IDLE → SEEKING → REPAIRING）
///   - 血量低但无敌（不会被敌人攻击，碰撞层不注册到受击层）
///   - 由平台管理生命周期（生成/销毁/补充）
///
/// 节点树：
///   RepairBot (Area2D)
///     ├── FirstSlotDummy（占位，防 Godot 4 bug）
///     ├── HealthComponent（有血量但不会被敌人命中）
///     ├── Sprite2D（绿色小圆形占位图）
///     └── RepairBotAI（AI 状态机）
///
/// 注意：无 CollisionShape2D — 维修机器人不参与物理碰撞（飞行单位规则）。
/// </summary>
public partial class RepairBot : EntityBase
{
    #region 私有字段

    /// <summary>AI 状态机组件（子节点）</summary>
    private RepairBotAI _ai;

    /// <summary>
    /// 平台生成点（机器人从平台出发、返回时定位用）。
    /// 由 Initialize() 设置，通常是 RepairPlatform 下的 Node2D 子节点。
    /// </summary>
    private Node2D _platformSpawnPoint;

    #endregion

    #region 公开属性

    /// <summary>当前 AI 状态（委托给 RepairBotAI.CurrentState）</summary>
    public RepairBotAI.BotState State => _ai?.CurrentState ?? RepairBotAI.BotState.IDLE;

    /// <summary>当前修复目标（可能为 null）</summary>
    public Node2D CurrentTarget => _ai?.CurrentTarget;

    /// <summary>所属维修平台引用（由 Initialize 设置）</summary>
    public Node2D PlatformSpawnPoint => _platformSpawnPoint;

    #endregion

    #region 生命周期

    public override void _Ready()
    {
        // 加入 repair_bots 组，便于全局查询
        AddToGroup("repair_bots");

        // ── 代码创建 HealthComponent（Dummy 占位模式，避免 Godot 4 .tscn bug）──
        // 先加 Dummy，再加真实节点，最后把 Dummy 移到索引 0
        var dummy = new Node();
        dummy.Name = "FirstSlotDummy";
        AddChild(dummy);

        var health = new HealthComponent();
        health.Name = "HealthComponent";
        // 维修机器人有血量但无敌：不会被敌人瞄准/命中，
        // 但保留 HealthComponent 以便未来扩展（如碰撞伤害、平台销毁时模拟损坏）
        health.MaxHealth = 100;
        AddChild(health);
        MoveChild(dummy, 0);

        // 调用 base._Ready()：EntityBase 查找 HealthComponent 并注册 Died 信号
        base._Ready();

        EntityName = "维修机器人";

        // ── 代码创建 Sprite2D（绿色小圆形）──
        var sprite = new Sprite2D();
        sprite.Name = "Sprite2D";
        sprite.Texture = GD.Load<Texture2D>("res://assets/sprites/repair_bot.png");
        AddChild(sprite);

        // ── 代码创建 RepairBotAI 状态机（作为子节点）──
        var ai = new RepairBotAI();
        ai.Name = "RepairBotAI";
        AddChild(ai);
        _ai = ai;

        GD.Print($"[RepairBot] 初始化完成，血量={health.CurrentHealth}/{health.MaxHealth}");
    }

    #endregion

    #region 公开方法

    /// <summary>
    /// 初始化机器人，设置所属平台信息。
    /// 由 RepairPlatform 在生成机器人时调用。
    ///
    /// 两个作用：
    ///   1. 记录平台生成点引用（机器人返回时定位用）
    ///   2. 通过 AI.SetPlatform() 通知 AI 平台位置（替代自动从父节点推断）
    /// </summary>
    /// <param name="platformSpawnPoint">平台生成点（Node2D）</param>
    public void Initialize(Node2D platformSpawnPoint)
    {
        _platformSpawnPoint = platformSpawnPoint;

        // 显式告知 AI 所属平台，避免依赖场景树父子关系推断
        _ai?.SetPlatform(platformSpawnPoint);
    }

    /// <summary>
    /// 激活机器人，立即开始扫描受损目标。
    /// 调用后 AI 从 IDLE 状态开始，重置扫描计时器触发第一次扫描。
    /// </summary>
    public void Activate()
    {
        _ai?.Activate();
    }

    #endregion

    #region 虚方法重写

    /// <summary>
    /// 机器人被销毁时的处理（通常由平台主动调用 QueueFree，此处仅打日志）。
    /// </summary>
    protected override void OnDied()
    {
        GD.Print("[RepairBot] 被销毁");
        base.OnDied();
    }

    #endregion
}
