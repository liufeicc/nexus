using Godot;
using OtrasShip.Entity;

namespace OtrasShip.AI;

/// <summary>
/// 维修机器人核心状态机 — 控制待命、飞向目标、持续修复行为。
/// 作为 RepairBot 的子节点，通过直线移动接近目标并持续修复血量。
///
/// 状态转换：
///   IDLE（待命）→ 发现受损目标 → SEEKING（飞向目标）
///   SEEKING（飞行）→ 到达维修范围 → REPAIRING（修复中）
///   SEEKING（飞行）→ 目标丢失 → IDLE（重新扫描）
///   REPAIRING（修复）→ 目标满血 → SEEKING（寻找下一个目标）
///   REPAIRING（修复）→ 目标丢失 → IDLE（重新扫描）
///   REPAIRING（修复）→ 无受损目标 → IDLE（返回平台待命）
///
/// 目标选择优先级：
///   1. 最近的受损炮塔（group: "turrets"）
///   2. 受损母舰（group: "mothership"）
///   3. 无受损目标 → 待命
/// </summary>
public partial class RepairBotAI : Node
{
    // ─────────── 状态枚举 ───────────

    public enum BotState
    {
        IDLE,       // 待命在平台上
        SEEKING,    // 飞往目标
        REPAIRING   // 持续修复
    }

    // ─────────── 配置参数 ───────────

    /// <summary>直线移动速度（像素/秒）</summary>
    [Export] public float MoveSpeed { get; set; } = 150f;

    /// <summary>每秒修复量（HP/秒）</summary>
    [Export] public float RepairRate { get; set; } = 8f;

    /// <summary>维修范围（像素）— 进入此范围后开始修复</summary>
    [Export] public float RepairRange { get; set; } = 50f;

    /// <summary>扫描间隔（秒）— IDLE 状态下每隔多久扫描一次受损目标</summary>
    [Export] public float ScanInterval { get; set; } = 0.5f;

    /// <summary>返回平台距离（像素）— IDLE 状态下与平台的距离阈值</summary>
    [Export] public float PlatformRange { get; set; } = 30f;

    // ─────────── 内部状态 ───────────

    private BotState _currentState = BotState.IDLE;
    private Node2D _owner;                    // 缓存 RepairBot（Owner 即父节点）
    private Node2D _target;                   // 当前修复目标
    private Node2D _platform;                 // 所属维修平台（用于 IDLE 时返回）
    private float _scanTimer;                 // 扫描计时器
    private float _healAccumulator;           // 治疗量累积器（Heal 接受 int，累积小数部分）

    /// <summary>当前 AI 状态（供外部查询）</summary>
    public BotState CurrentState => _currentState;

    /// <summary>当前修复目标（可能为 null）</summary>
    public Node2D CurrentTarget => _target;

    // ─────────── 信号 ───────────

    /// <summary>状态变化时发出（携带新状态名称）</summary>
    [Signal] public delegate void StateChangedEventHandler(string newState);

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        // 获取父节点作为 Owner（RepairBot 是 Node2D）
        _owner = GetParent<Node2D>();
        if (_owner == null)
        {
            GD.PrintErr("[RepairBotAI] 未找到父节点 RepairBot");
            return;
        }

        // 维修平台：RepairBot 的父节点链中找到 RepairPlatform，
        // 约定 RepairBot 是 RepairPlatform 的子节点，取父节点即可。
        // 如果平台通过 SetPlatform 显式设置，则优先使用显式值。
        if (_platform == null)
        {
            _platform = _owner.GetParentOrNull<Node2D>();
        }

        ChangeState(BotState.IDLE);
    }

    public override void _Process(double delta)
    {
        if (_owner == null) return;

        float dt = (float)delta;

        switch (_currentState)
        {
            case BotState.IDLE:
                UpdateIdle(dt);
                break;
            case BotState.SEEKING:
                UpdateSeeking(dt);
                break;
            case BotState.REPAIRING:
                UpdateRepairing(dt);
                break;
        }
    }

    // ─────────── 公开方法 ───────────

    /// <summary>
    /// 显式设置所属维修平台。
    /// 优先于 _Ready 中自动获取（从父节点链推断），
    /// 适用于 RepairBot 尚未挂到平台下方就需要指定平台的场景。
    /// </summary>
    /// <param name="platform">维修平台节点（Node2D）</param>
    public void SetPlatform(Node2D platform)
    {
        _platform = platform;
    }

    /// <summary>
    /// 激活机器人，从 IDLE 状态开始扫描受损目标。
    /// 如果当前不在 IDLE 状态则忽略。
    /// </summary>
    public void Activate()
    {
        if (_currentState == BotState.IDLE)
        {
            // 重置扫描计时器，立即执行第一次扫描
            _scanTimer = ScanInterval;
        }
    }

    // ─────────── 状态更新 ───────────

    /// <summary>
    /// IDLE 状态：定期扫描受损目标。
    /// 发现目标 → SEEKING；无目标时停留在平台附近。
    /// </summary>
    private void UpdateIdle(float dt)
    {
        _scanTimer += dt;
        if (_scanTimer < ScanInterval) return;

        _scanTimer = 0f;
        var target = ScanForTarget();
        if (target != null)
        {
            _target = target;
            ChangeState(BotState.SEEKING);
        }
    }

    /// <summary>
    /// SEEKING 状态：直线飞向目标。
    /// 到达维修范围 → REPAIRING；目标丢失 → IDLE。
    /// </summary>
    private void UpdateSeeking(float dt)
    {
        // 检查目标是否仍有效
        if (_target == null || !IsInstanceValid(_target))
        {
            _target = null;
            ChangeState(BotState.IDLE);
            return;
        }

        // 检查目标是否已修复
        var health = _target.GetNodeOrNull<HealthComponent>("HealthComponent");
        if (health == null || health.IsDead || health.CurrentHealth >= health.MaxHealth)
        {
            // 目标已满血或死亡，寻找下一个目标
            _target = ScanForTarget();
            if (_target == null)
            {
                ChangeState(BotState.IDLE);
                return;
            }
        }

        // 检查是否到达维修范围
        float dist = _owner.GlobalPosition.DistanceTo(_target.GlobalPosition);
        if (dist <= RepairRange)
        {
            ChangeState(BotState.REPAIRING);
            return;
        }

        // 直线飞向目标
        MoveToTarget(dt);
    }

    /// <summary>
    /// REPAIRING 状态：持续修复目标。
    /// 目标满血 → 寻找下一个目标或返回 IDLE；目标丢失 → IDLE。
    /// </summary>
    private void UpdateRepairing(float dt)
    {
        // 检查目标是否仍有效
        if (_target == null || !IsInstanceValid(_target))
        {
            _target = null;
            ChangeState(BotState.IDLE);
            return;
        }

        // 持续修复
        Repair(dt);

        // 检查目标是否已修复
        var health = _target.GetNodeOrNull<HealthComponent>("HealthComponent");
        if (health == null || health.IsDead || health.CurrentHealth >= health.MaxHealth)
        {
            // 目标满血，寻找下一个目标
            var nextTarget = ScanForTarget();
            if (nextTarget != null)
            {
                _target = nextTarget;
                // 保持 REPAIRING 状态，直接飞向下一个目标
                ChangeState(BotState.SEEKING);
            }
            else
            {
                // 无更多受损目标，返回平台待命
                _target = null;
                ChangeState(BotState.IDLE);
            }
        }
    }

    // ─────────── 目标选择 ───────────

    /// <summary>
    /// 扫描并选择最近的受损目标。
    /// 优先级：
    ///   1. 最近的受损炮塔（group: "turrets"）
    ///   2. 受损母舰（group: "mothership"）
    /// 返回 null 表示无受损目标。
    /// </summary>
    private Node2D ScanForTarget()
    {
        // 优先级 1: 最近受损炮塔
        var turrets = GetTree().GetNodesInGroup("turrets");
        Node2D nearestTurret = FindNearestDamaged(turrets);
        if (nearestTurret != null)
            return nearestTurret;

        // 优先级 2: 受损母舰
        var mothership = GetTree().GetFirstNodeInGroup("mothership");
        if (mothership is Node2D mothership2D)
        {
            var health = mothership2D.GetNodeOrNull<HealthComponent>("HealthComponent");
            if (health != null && !health.IsDead && health.CurrentHealth < health.MaxHealth)
                return mothership2D;
        }

        // 无受损目标
        return null;
    }

    /// <summary>
    /// 从节点列表中找出最近的受损目标。
    /// 跳过死亡的和满血的目标。
    /// </summary>
    private Node2D FindNearestDamaged(Godot.Collections.Array<Node> nodes)
    {
        Node2D nearest = null;
        float minDistSq = float.MaxValue;

        foreach (var node in nodes)
        {
            if (node is not Node2D candidate) continue;

            var health = candidate.GetNodeOrNull<HealthComponent>("HealthComponent");
            if (health == null || health.IsDead) continue;
            if (health.CurrentHealth >= health.MaxHealth) continue;

            float distSq = _owner.GlobalPosition.DistanceSquaredTo(candidate.GlobalPosition);
            if (distSq < minDistSq)
            {
                minDistSq = distSq;
                nearest = candidate;
            }
        }

        return nearest;
    }

    // ─────────── 移动 ───────────

    /// <summary>
    /// 直线飞向目标。
    /// 计算方向向量，归一化后按 MoveSpeed 移动，同时更新朝向。
    /// </summary>
    private void MoveToTarget(float delta)
    {
        if (_target == null || !IsInstanceValid(_target)) return;

        Vector2 direction = (_target.GlobalPosition - _owner.GlobalPosition).Normalized();
        _owner.GlobalPosition += direction * MoveSpeed * delta;
        _owner.Rotation = direction.Angle();
    }

    // ─────────── 修复 ───────────

    /// <summary>
    /// 持续修复目标。
    /// 由于 HealthComponent.Heal() 接受 int，使用累积器处理小数部分。
    /// 每帧累积 RepairRate * delta，整数部分执行 Heal。
    /// </summary>
    private void Repair(float delta)
    {
        if (_target == null || !IsInstanceValid(_target)) return;

        var health = _target.GetNodeOrNull<HealthComponent>("HealthComponent");
        if (health == null || health.IsDead) return;

        // 累积治疗量
        _healAccumulator += RepairRate * delta;
        int healAmount = (int)_healAccumulator;

        if (healAmount > 0)
        {
            health.Heal(healAmount);
            _healAccumulator -= healAmount;
        }
    }

    // ─────────── 状态切换 ───────────

    /// <summary>
    /// 切换状态，重置相关计时器。
    /// </summary>
    private void ChangeState(BotState newState)
    {
        if (_currentState == newState) return;

        _currentState = newState;

        // 状态进入时重置累积器
        if (newState == BotState.IDLE)
        {
            _scanTimer = 0f;
            _healAccumulator = 0f;
        }

        EmitSignal(SignalName.StateChanged, newState.ToString());
    }
}
