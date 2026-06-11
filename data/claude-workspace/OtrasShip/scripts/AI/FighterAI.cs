using System.Linq;
using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.AI;

/// <summary>
/// 友方战斗机 AI 状态机 — 控制巡逻、战斗、返航行为。
/// 作为 Fighter 的子节点，通过 FlightMovement 控制飞行路径。
///
/// 状态转换：
///   PATROL（巡逻）→ 发现敌人 → COMBAT（战斗）
///   COMBAT（战斗）→ 血量低 → RETURN（返航）
///   COMBAT（战斗）→ 无敌人 → PATROL（巡逻）
///   RETURN（返航）→ 到达母舰 → 消失回库
/// </summary>
public partial class FighterAI : Node
{
    // ─────────── 状态枚举 ───────────

    public enum State
    {
        Patrol,     // 巡逻（绕母舰飞行）
        Combat,     // 追击并攻击敌人
        Return,     // 返航（飞向母舰）
    }

    // ─────────── 配置参数 ───────────

    /// <summary>攻击距离（像素）</summary>
    [Export] public float AttackRange { get; set; } = 500f;

    /// <summary>血量低于此比例时返航</summary>
    [Export] public float ReturnHealthRatio { get; set; } = 0.3f;

    /// <summary>巡逻半径（从母舰中心算起）</summary>
    [Export] public float PatrolRadius { get; set; } = 700f;

    /// <summary>巡逻角速度（弧度/秒）</summary>
    [Export] public float PatrolSpeed { get; set; } = 0.5f;

    /// <summary>到达母舰的距离阈值（像素）</summary>
    [Export] public float ArrivalDistance { get; set; } = 50f;

    // ─────────── 内部状态 ───────────

    private State _currentState = State.Patrol;
    private FlightMovement _flight;
    private Node2D _owner;
    private Node2D _mothership;
    private Node2D _currentTarget;
    private float _patrolAngle;
    private bool _hasArrived = false;  // 防止 UpdateReturn 每帧重复发射 ArrivedAtMothership 信号
    private RandomNumberGenerator _rng = new();

    /// <summary>当前 AI 状态（供 Fighter 查询是否应射击）</summary>
    public State CurrentState => _currentState;

    /// <summary>
    /// 是否允许开火 — 仅在 Combat 状态且目标在 AttackRange 内时允许。
    /// 超出攻击距离时继续追踪但不射击。
    /// </summary>
    public bool CanFire
    {
        get
        {
            if (_currentState != State.Combat) return false;
            if (_currentTarget == null || !IsInstanceValid(_currentTarget)) return false;
            float distSq = _owner.GlobalPosition.DistanceSquaredTo(_currentTarget.GlobalPosition);
            return distSq <= AttackRange * AttackRange;
        }
    }

    /// <summary>当前战斗目标（可能为 null）</summary>
    public Node2D CurrentTarget => _currentTarget;

    // ─────────── 信号 ───────────

    /// <summary>战斗机已到达母舰（返航完成）</summary>
    [Signal] public delegate void ArrivedAtMothershipEventHandler();

    /// <summary>状态变化时发出</summary>
    [Signal] public delegate void StateChangedEventHandler(string newState);

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        _owner = GetParent<Node2D>();
        _flight = GetNodeOrNull<FlightMovement>("../FlightMovement");
        _mothership = GetTree().Root.GetNodeOrNull<Node2D>("Main/Mothership");

        if (_flight == null) GD.PrintErr("[FighterAI] 未找到 FlightMovement");
        if (_mothership == null) GD.PrintErr("[FighterAI] 未找到母舰");

        // 随机初始巡逻角度
        _patrolAngle = _rng.RandfRange(-Mathf.Pi, Mathf.Pi);

        ChangeState(State.Patrol);
    }

    public override void _Process(double delta)
    {
        if (_owner == null || _flight == null || _mothership == null) return;

        float dt = (float)delta;

        switch (_currentState)
        {
            case State.Patrol:
                UpdatePatrol(dt);
                break;
            case State.Combat:
                UpdateCombat(dt);
                break;
            case State.Return:
                UpdateReturn(dt);
                break;
        }
    }

    // ─────────── 状态更新 ───────────

    /// <summary>
    /// PATROL：绕母舰飞行巡逻，每帧搜索最近敌人。
    /// 发现敌人则切换到 COMBAT。
    /// </summary>
    private void UpdatePatrol(float dt)
    {
        // 搜索最近敌人
        var nearest = FindNearestEnemy();
        if (nearest != null)
        {
            _currentTarget = nearest;
            ChangeState(State.Combat);
            return;
        }

        // 绕母舰巡逻
        _patrolAngle += PatrolSpeed * dt;
        Vector2 patrolTarget = _mothership.GlobalPosition + new Vector2(
            Mathf.Cos(_patrolAngle) * PatrolRadius,
            Mathf.Sin(_patrolAngle) * PatrolRadius
        );
        _flight.SetTarget(patrolTarget);
    }

    /// <summary>
    /// COMBAT：追踪并攻击敌人。
    /// 目标消失或无敌人 → PATROL；血量低 → RETURN。
    /// </summary>
    private void UpdateCombat(float dt)
    {
        // 检查目标是否仍有效
        if (_currentTarget == null || !IsInstanceValid(_currentTarget))
        {
            _currentTarget = FindNearestEnemy();
            if (_currentTarget == null)
            {
                ChangeState(State.Patrol);
                return;
            }
        }

        // 检查血量
        var health = _owner.GetNodeOrNull<HealthComponent>("HealthComponent");
        if (health != null && !health.IsDead)
        {
            float healthRatio = (float)health.CurrentHealth / health.MaxHealth;
            if (healthRatio <= ReturnHealthRatio)
            {
                ChangeState(State.Return);
                return;
            }
        }

        // 追踪目标（使用 FlightMovement 跟踪节点）
        _flight.SetTargetNode(_currentTarget);
    }

    /// <summary>
    /// RETURN：飞向母舰，到达后发出信号并消失。
    /// 使用 _hasArrived 标志防止每帧重复发射信号。
    /// </summary>
    private void UpdateReturn(float dt)
    {
        _flight.SetTarget(_mothership.GlobalPosition);

        // 检查是否到达母舰（只发一次信号）
        if (_hasArrived) return;
        float dist = _owner.GlobalPosition.DistanceTo(_mothership.GlobalPosition);
        if (dist <= ArrivalDistance)
        {
            _hasArrived = true;
            EmitSignal(SignalName.ArrivedAtMothership);
        }
    }

    // ─────────── 公共方法 ───────────

    /// <summary>
    /// 强制返航（波次结束时由机库调用）
    /// </summary>
    public void ForceReturn()
    {
        ChangeState(State.Return);
    }

    // ─────────── 状态切换 ───────────

    private void ChangeState(State newState)
    {
        if (_currentState == newState) return;
        _currentState = newState;
        // 进入返航时重置标志，离开返航时也重置（支持多次 ForceReturn）
        if (newState == State.Return) _hasArrived = false;
        EmitSignal(SignalName.StateChanged, newState.ToString());
    }

    // ─────────── 目标选择 ───────────

    /// <summary>
    /// 搜索最近敌人 — 遍历 enemy_fighter 和 enemy_battleship 组。
    /// 使用 DistanceSquaredTo 计算距离。
    /// 返回最近的存活敌人，无敌人时返回 null。
    /// </summary>
    private Node2D FindNearestEnemy()
    {
        Node2D nearest = null;
        float minDistSq = float.MaxValue;

        // 搜索敌方战斗机
        foreach (var node in GetTree().GetNodesInGroup("enemy_fighter"))
        {
            if (node is not Node2D target) continue;
            var health = target.GetNodeOrNull<HealthComponent>("HealthComponent");
            if (health != null && health.IsDead) continue;

            float distSq = _owner.GlobalPosition.DistanceSquaredTo(target.GlobalPosition);
            if (distSq < minDistSq)
            {
                minDistSq = distSq;
                nearest = target;
            }
        }

        // 搜索大型战舰
        foreach (var node in GetTree().GetNodesInGroup("enemy_battleship"))
        {
            if (node is not Node2D target) continue;
            var health = target.GetNodeOrNull<HealthComponent>("HealthComponent");
            if (health != null && health.IsDead) continue;

            float distSq = _owner.GlobalPosition.DistanceSquaredTo(target.GlobalPosition);
            if (distSq < minDistSq)
            {
                minDistSq = distSq;
                nearest = target;
            }
        }

        return nearest;
    }
}
