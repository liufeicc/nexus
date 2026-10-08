# 阶段7：战斗机与机库系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现友方战斗机与机库系统 — 机库生成战斗机，战斗机自动追击敌人，被毁后自动补充。

**Architecture:** Fighter 继承 EntityBase，复用 FlightMovement 飞行组件。FighterAI 状态机控制巡逻/战斗/返航行为。HangarBay 管理战斗机生命周期（生成、补充、冷却）。TurretSlotManager 扩展支持机库插槽建造。

**Tech Stack:** Godot 4.4.1 + C#（.NET 8.0）

---

## Task 1: 生成友方战斗机占位图

**Files:**
- Create: `assets/sprites/player_fighter.png`（30×18 绿色矩形）

- [ ] **Step 1: 用 Python PIL 生成占位图**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
python3 -c "
from PIL import Image
img = Image.new('RGBA', (30, 18), (0, 200, 0, 255))
img.save('assets/sprites/player_fighter.png')
print('OK: player_fighter.png 30x18 green')
"
```

Expected: `OK: player_fighter.png 30x18 green`

- [ ] **Step 2: 触发 Godot 资源导入**

```bash
/home/liufei/data/godot/Godot_v4.4.1-stable_mono_linux.x86_64 --editor --headless --quit --path /home/liufei/data/claude-workspace/OtrasShip
```

Expected: 生成 `assets/sprites/player_fighter.png.import`

- [ ] **Step 3: 提交**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
git add assets/sprites/player_fighter.png assets/sprites/player_fighter.png.import
git commit -m "feat: 添加友方战斗机占位图（绿色矩形 30x18）"
```

---

## Task 2: 更新碰撞层配置与敌方子弹检测

**Files:**
- Modify: `project.godot:48-57`（新增层9）
- Modify: `scripts/Core/GameConstants.cs`（新增常量）
- Modify: `scripts/Weapon/EnemyBullet.cs`（新增友方战斗机命中检测）

- [ ] **Step 1: 更新 project.godot — 新增 player_fighter 层**

在 `[layer_names]` 段的 `2d_physics/layer_8="turret"` 后面添加：

```ini
2d_physics/layer_9="player_fighter"
```

- [ ] **Step 2: 更新 GameConstants.cs — 新增友方战斗机碰撞层常量**

在 `TurretCollisionLayer` 后面添加：

```csharp
/// <summary>友方战斗机碰撞层（layer 9），位值 256</summary>
public const uint PlayerFighterCollisionLayer = 256;
```

- [ ] **Step 3: 修改 EnemyBullet.cs — 新增友方战斗机命中检测**

EnemyBullet 的碰撞检测（`CheckTurretHit`/`CheckManualHit`）不检测友方战斗机。需新增 `CheckFighterHit()` 方法。

在 `CheckTurretHit()` 方法之后，`CheckManualHit()` 方法之前，添加：

```csharp
/// <summary>
/// 友方战斗机命中检测 — 遍历 player_fighter 组，用中心距离检测。
/// 命中后通过 HealthComponent 造成伤害。
/// </summary>
private bool CheckFighterHit()
{
    if (_hasHit) return false;

    var fighters = GetTree().GetNodesInGroup("player_fighter");
    foreach (var node in fighters)
    {
        if (node is not Node2D target) continue;

        float dist = GlobalPosition.DistanceTo(target.GlobalPosition);
        if (dist <= 20f)  // 命中检测半径（匹配战斗机碰撞半径 15px）
        {
            var health = target.GetNodeOrNull<Entity.HealthComponent>("HealthComponent");
            if (health != null && !health.IsDead)
            {
                health.TakeDamage(Damage);
            }
            _hasHit = true;
            return true;
        }
    }

    return false;
}
```

在 `_PhysicsProcess()` 中，在 `CheckTurretHit()` 调用之后、`if (!FiredInsideMothership && CheckManualHit())` 之前，添加：

```csharp
// ─── 友方战斗机命中检测 ───
if (CheckFighterHit())
{
    BulletPool.Instance.Return(this);
    return;
}
```

- [ ] **Step 4: 编译验证**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded

- [ ] **Step 5: 提交**

```bash
git add project.godot scripts/Core/GameConstants.cs scripts/Weapon/EnemyBullet.cs
git commit -m "feat: 新增碰撞层9 player_fighter，敌方子弹可命中友方战斗机"
```

---

## Task 3: 创建 FighterAI 状态机

**Files:**
- Create: `scripts/AI/FighterAI.cs`

- [ ] **Step 1: 创建 FighterAI.cs**

```csharp
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
    private RandomNumberGenerator _rng = new();

    /// <summary>当前 AI 状态（供 Fighter 查询是否应射击）</summary>
    public State CurrentState => _currentState;

    /// <summary>是否允许开火（仅 Combat 状态）</summary>
    public bool CanFire => _currentState == State.Combat;

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
    /// </summary>
    private void UpdateReturn(float dt)
    {
        _flight.SetTarget(_mothership.GlobalPosition);

        // 检查是否到达母舰
        float dist = _owner.GlobalPosition.DistanceTo(_mothership.GlobalPosition);
        if (dist <= ArrivalDistance)
        {
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
        EmitSignal(SignalName.StateChanged, newState.ToString());
    }

    // ─────────── 目标选择 ───────────

    /// <summary>
    /// 搜索最近敌人 — 遍历 enemy_fighter 和 enemy_battleship 组。
    /// 使用 CollisionShapeHelper.GetShapeDistanceSquaredTo() 计算距离。
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
```

- [ ] **Step 2: 编译验证**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded

- [ ] **Step 3: 提交**

```bash
git add scripts/AI/FighterAI.cs
git commit -m "feat: 添加友方战斗机 AI 状态机（Patrol/Combat/Return）"
```

---

## Task 4: 创建 Fighter 实体

**Files:**
- Create: `scripts/Fighter/Fighter.cs`
- Create: `scenes/Fighter.tscn`

- [ ] **Step 1: 创建 Fighter.cs**

```csharp
using Godot;
using OtrasShip.AI;
using OtrasShip.Core;
using OtrasShip.Entity;
using OtrasShip.Mothership;
using OtrasShip.Weapon;

namespace OtrasShip.Fighter;

/// <summary>
/// 友方战斗机 — 由机库生成，自动追击敌人。
/// 使用 FlightMovement 飞行，FighterAI 控制行为状态机。
/// 血量低时返航回库，被毁后由机库冷却补充。
/// </summary>
public partial class Fighter : EntityBase
{
    // ─────────── 配置参数 ───────────

    [Export] public float FireRate { get; set; } = 0.3f;
    [Export] public int BulletDamage { get; set; } = 15;
    [Export] public float BulletSpeed { get; set; } = 800f;
    [Export] public float CollisionRadius { get; set; } = 15f;

    // ─────────── 内部状态 ───────────

    private FighterAI _ai;
    private FlightMovement _flight;
    private float _fireCooldown;

    /// <summary>所属机库引用（由 HangarBay 设置）</summary>
    public HangarBay OwnerHangar { get; set; }

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        // 加入友方战斗机组
        AddToGroup("player_fighter");

        // 动态创建 HealthComponent（Dummy 占位模式）
        var dummy = new Node();
        dummy.Name = "FirstSlotDummy";
        AddChild(dummy);

        var health = new HealthComponent();
        health.Name = "HealthComponent";
        health.MaxHealth = 100;
        AddChild(health);
        MoveChild(dummy, 0);

        // 调用 base._Ready()（EntityBase 查找 HealthComponent 并挂钩 Died 信号）
        base._Ready();

        EntityName = "友方战斗机";

        // 动态创建碰撞体
        var collisionShape = new CollisionShape2D();
        collisionShape.Name = "CollisionShape";
        var circle = new CircleShape2D();
        circle.Radius = CollisionRadius;
        collisionShape.Shape = circle;
        AddChild(collisionShape);
        MoveChild(collisionShape, 0);

        // 动态创建精灵（绿色三角形占位）
        var sprite = new Sprite2D();
        sprite.Name = "Sprite";
        PlaceholderArt.ApplyTriangle(sprite, 30, new Color(0, 0.8f, 0));
        AddChild(sprite);
        MoveChild(sprite, 0);

        // 获取 AI 和飞行组件
        _ai = GetNodeOrNull<FighterAI>("FighterAI");
        _flight = GetNodeOrNull<FlightMovement>("FlightMovement");

        // 添加血量显示条
        var healthBar = new HealthBar();
        healthBar.Name = "HealthBar";
        AddChild(healthBar);

        // 连接返航到达信号
        if (_ai != null)
        {
            _ai.ArrivedAtMothership += OnArrivedAtMothership;
        }

        GD.Print($"[Fighter] 初始化完成，血量={health.CurrentHealth}/{health.MaxHealth}");
    }

    public override void _ExitTree()
    {
        if (_ai != null)
        {
            _ai.ArrivedAtMothership -= OnArrivedAtMothership;
        }
    }

    public override void _Process(double delta)
    {
        float dt = (float)delta;

        // 射击冷却
        if (_fireCooldown > 0) _fireCooldown -= dt;

        // AI 允许开火且冷却完成时射击
        if (_ai != null && _ai.CanFire && _fireCooldown <= 0 && _ai.CurrentTarget != null)
        {
            Fire();
            _fireCooldown = FireRate;
        }
    }

    // ─────────── 射击 ───────────

    /// <summary>
    /// 发射玩家子弹（从对象池获取），方向朝向战斗机正前方。
    /// </summary>
    private void Fire()
    {
        if (BulletPool.Instance == null) return;

        var bullet = BulletPool.Instance.GetBullet();
        Vector2 direction = new Vector2(1, 0).Rotated(Rotation);

        bullet.GlobalPosition = GlobalPosition;
        bullet.Initialize(direction, BulletDamage, BulletSpeed);
    }

    // ─────────── 事件处理 ───────────

    /// <summary>
    /// 返航到达母舰 — 通知机库并消失。
    /// </summary>
    private void OnArrivedAtMothership()
    {
        GD.Print("[Fighter] 返航到达母舰，回库");
        OwnerHangar?.OnFighterReturned();
        QueueFree();
    }

    protected override void OnDied()
    {
        GD.Print("[Fighter] 被摧毁");
        OwnerHangar?.OnFighterDestroyed();
        base.OnDied();
    }
}
```

- [ ] **Step 2: 创建 Fighter.tscn**

```
[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://scripts/Fighter/Fighter.cs" id="1_fighter"]
[ext_resource type="Script" path="res://scripts/AI/FlightMovement.cs" id="2_flight"]
[ext_resource type="Script" path="res://scripts/AI/FighterAI.cs" id="3_ai"]

[node name="Fighter" type="Area2D"]
script = ExtResource("1_fighter")
collision_layer = 256
collision_mask = 16

[node name="FlightMovement" type="Node" parent="."]
script = ExtResource("2_flight")
MaxSpeed = 400
Acceleration = 300
TurnSpeed = 6.0
Drag = 2.0

[node name="FighterAI" type="Node" parent="."]
script = ExtResource("3_ai")
AttackRange = 500
ReturnHealthRatio = 0.3
PatrolRadius = 700
PatrolSpeed = 0.5
ArrivalDistance = 50
```

- [ ] **Step 3: 编译验证**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded

- [ ] **Step 4: 提交**

```bash
git add scripts/Fighter/Fighter.cs scenes/Fighter.tscn
git commit -m "feat: 添加友方战斗机实体（Fighter + Fighter.tscn）"
```

---

## Task 5: 创建 HangarBay 机库

**Files:**
- Create: `scripts/Mothership/HangarBay.cs`

- [ ] **Step 1: 创建 HangarBay.cs**

```csharp
using System.Collections.Generic;
using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Mothership;

/// <summary>
/// 机库 — 管理最多 4 架战斗机。
/// 挂载在母舰上，负责生成战斗机、跟踪存活数、冷却补充。
/// 战斗机被毁或返航后，经过冷却时间自动补充新战斗机。
/// </summary>
public partial class HangarBay : EntityBase
{
    // ─────────── 配置参数 ───────────

    /// <summary>机库最大战斗机数量</summary>
    [Export] public int MaxFighters { get; set; } = 4;

    /// <summary>战斗机被毁/返航后重新生成的冷却时间（秒）</summary>
    [Export] public float SpawnCooldown { get; set; } = 10f;

    /// <summary>建造消耗资源</summary>
    [Export] public int HangarCost { get; set; } = 300;

    /// <summary>机库血量</summary>
    [Export] public int HangarMaxHealth { get; set; } = 400;

    /// <summary>机库碰撞体半宽</summary>
    [Export] public float SlotHalfWidth { get; set; } = 30f;

    /// <summary>机库碰撞体半高</summary>
    [Export] public float SlotHalfHeight { get; set; } = 20f;

    [Export(PropertyHint.File)]
    public string FighterScenePath { get; set; } = "res://scenes/Fighter.tscn";

    // ─────────── 内部状态 ───────────

    private int _aliveCount;
    private Queue<float> _cooldownTimers = new();
    private bool _isBuilt;
    private PackedScene _fighterScene;
    private Node2D _mothership;

    /// <summary>机库是否已建造</summary>
    public bool IsBuilt => _isBuilt;

    /// <summary>机库插槽索引（由 TurretSlotManager 设置）</summary>
    public int SlotIndex { get; set; }

    // ─────────── 信号 ───────────

    /// <summary>机库被摧毁时发出（携带插槽索引）</summary>
    [Signal] public delegate void HangarDiedEventHandler(int slotIndex);

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        EntityName = "机库";
        _mothership = GetTree().Root.GetNodeOrNull<Node2D>("Main/Mothership");

        // 加载战斗机场景
        _fighterScene = GD.Load<PackedScene>(FighterScenePath);
        if (_fighterScene == null)
        {
            GD.PrintErr("[HangarBay] 无法加载战斗机场景");
        }

        // 未建造时不初始化子节点
        if (!_isBuilt) return;

        InitBuilt();
    }

    public override void _Process(double delta)
    {
        if (!_isBuilt) return;

        float dt = (float)delta;

        // 处理冷却队列
        if (_cooldownTimers.Count > 0)
        {
            float timer = _cooldownTimers.Peek() - dt;
            if (timer <= 0)
            {
                _cooldownTimers.Dequeue();
                SpawnFighter();
            }
            else
            {
                _cooldownTimers.Dequeue();
                _cooldownTimers.Enqueue(timer);
            }
        }
    }

    // ─────────── 公共方法 ───────────

    /// <summary>
    /// 建造机库 — 扣除资源并初始化。
    /// 由 TurretSlotManager 调用。
    /// </summary>
    public void Build()
    {
        if (_isBuilt) return;

        _isBuilt = true;
        InitBuilt();

        // 初始生成所有战斗机（分批次，间隔 0.5s）
        for (int i = 0; i < MaxFighters; i++)
        {
            CallDeferred(MethodName.SpawnFighter);
        }
    }

    /// <summary>
    /// 战斗机被摧毁（非正常返航）— 启动冷却计时。
    /// 由 Fighter.OnDied() 调用。
    /// </summary>
    public void OnFighterDestroyed()
    {
        if (!_isBuilt) return;
        _aliveCount = Mathf.Max(0, _aliveCount - 1);

        // 启动冷却计时
        _cooldownTimers.Enqueue(SpawnCooldown);

        GD.Print($"[HangarBay] 战斗机被毁，存活={_aliveCount}，冷却={SpawnCooldown}s");
    }

    /// <summary>
    /// 战斗机返航到达母舰 — 消失回库，启动冷却计时。
    /// 由 Fighter.OnArrivedAtMothership() 调用。
    /// </summary>
    public void OnFighterReturned()
    {
        if (!_isBuilt) return;
        _aliveCount = Mathf.Max(0, _aliveCount - 1);

        // 返航后也进入冷却（满血重新出发）
        _cooldownTimers.Enqueue(SpawnCooldown);

        GD.Print($"[HangarBay] 战斗机返航，存活={_aliveCount}，冷却={SpawnCooldown}s");
    }

    /// <summary>
    /// 召回所有战斗机（波次结束时使用）。
    /// 遍历所有存活的 player_fighter，强制切 Return 状态。
    /// </summary>
    public void RecallAll()
    {
        if (!_isBuilt) return;

        var fighters = GetTree().GetNodesInGroup("player_fighter");
        foreach (var node in fighters)
        {
            if (node is Fighter.Fighter fighter)
            {
                if (fighter.OwnerHangar == this)
                {
                    var ai = fighter.GetNodeOrNull<AI.FighterAI>("FighterAI");
                    ai?.ForceReturn();
                }
            }
        }

        GD.Print("[HangarBay] 召回所有战斗机");
    }

    // ─────────── 私有方法 ───────────

    /// <summary>
    /// 初始化已建造状态（创建 HealthComponent、精灵等）。
    /// </summary>
    private void InitBuilt()
    {
        // 动态创建 HealthComponent（Dummy 占位）
        var dummy = new Node();
        dummy.Name = "FirstSlotDummy";
        AddChild(dummy);

        var health = new HealthComponent();
        health.Name = "HealthComponent";
        health.MaxHealth = HangarMaxHealth;
        AddChild(health);
        MoveChild(dummy, 0);

        // 调用 base._Ready()（挂钩 Died 信号）
        base._Ready();

        // 动态创建碰撞体
        var collisionShape = new CollisionShape2D();
        collisionShape.Name = "CollisionShape";
        var rect = new RectangleShape2D();
        rect.Size = new Vector2(SlotHalfWidth * 2, SlotHalfHeight * 2);
        collisionShape.Shape = rect;
        AddChild(collisionShape);
        MoveChild(collisionShape, 0);

        // 动态创建精灵（蓝色矩形占位）
        var sprite = new Sprite2D();
        sprite.Name = "Sprite";
        PlaceholderArt.ApplyRect(sprite, (int)(SlotHalfWidth * 2), (int)(SlotHalfHeight * 2), new Color(0.2f, 0.4f, 0.8f));
        AddChild(sprite);
        MoveChild(sprite, 0);

        // 加入机库组
        AddToGroup("hangar");

        GD.Print($"[HangarBay] 建造完成，血量={health.CurrentHealth}/{health.MaxHealth}，最大战斗机={MaxFighters}");
    }

    /// <summary>
    /// 生成一架战斗机并添加到 Main 场景（世界坐标）。
    /// </summary>
    private void SpawnFighter()
    {
        if (_fighterScene == null || _mothership == null) return;
        if (_aliveCount >= MaxFighters) return;

        var fighter = _fighterScene.Instantiate<Fighter.Fighter>();

        // 设置机库出口位置（世界坐标）
        Vector2 spawnOffset = new Vector2(0, (_aliveCount % 2 == 0 ? -15f : 15f));
        fighter.GlobalPosition = GlobalPosition + spawnOffset;

        // 设置所属机库引用
        fighter.OwnerHangar = this;

        // 添加到 Main 场景（世界坐标，不是母舰子节点）
        var main = GetTree().Root.GetNode("Main");
        main.AddChild(fighter);

        _aliveCount++;
        GD.Print($"[HangarBay] 生成战斗机 #{_aliveCount}");
    }

    protected override void OnDied()
    {
        GD.Print("[HangarBay] 被摧毁");
        _isBuilt = false;
        _cooldownTimers.Clear();

        // 召回所有战斗机
        RecallAll();

        EmitSignal(SignalName.HangarDied, SlotIndex);
        base.OnDied();
    }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded（HangarBay 使用了 `Fighter.Fighter`，此时 Fighter 命名空间已存在）

- [ ] **Step 3: 提交**

```bash
git add scripts/Mothership/HangarBay.cs
git commit -m "feat: 添加机库管理器 HangarBay（生成、补充、冷却）"
```

---

## Task 6: 扩展 TurretSlotManager 支持机库

**Files:**
- Modify: `scripts/Mothership/TurretSlotManager.cs`（新增机库插槽支持）
- Modify: `scenes/Mothership.tscn`（添加 4 个 HangarBay 节点）

- [ ] **Step 1: 修改 TurretSlotManager.cs — 新增机库支持**

在文件头部添加 `using OtrasShip.Mothership;`（HangarBay 在同一命名空间，不需要额外 using）。

在 `SlotCount` 常量后添加：

```csharp
/// <summary>机库插槽数量</summary>
public const int HangarSlotCount = 4;

/// <summary>机库建造费用</summary>
public const int HangarBuildCost = 300;
```

在 `SlotPositions` 后添加机库位置数组：

```csharp
/// <summary>4 个机库插槽的相对位置（相对于母舰中心，后部）</summary>
private static readonly Vector2[] HangarPositions = new Vector2[]
{
    new(-350, -120),   // 机库0：船尾左上
    new(-350, 120),    // 机库1：船尾左下
    new(-420, -120),   // 机库2：船尾右上（更靠后）
    new(-420, 120),    // 机库3：船尾右下（更靠后）
};
```

在炮塔数组后添加机库数组：

```csharp
/// <summary>已安装的机库数组（null 表示空插槽）</summary>
private HangarBay[] _installedHangars = new HangarBay[HangarSlotCount];

/// <summary>机库空位视觉节点数组</summary>
private TurretSlotVisual[] _hangarVisuals = new TurretSlotVisual[HangarSlotCount];
```

在 `_Ready()` 末尾（炮塔菜单创建之后）添加机库初始化：

```csharp
// ─── 机库插槽初始化 ───
for (int i = 0; i < HangarSlotCount; i++)
{
    var visual = new TurretSlotVisual();
    visual.Name = $"HangarVisual_{i}";
    visual.Position = HangarPositions[i];
    visual.SlotIndex = 100 + i;  // 机库插槽索引从 100 开始（区别于炮塔 0-11）
    AddChild(visual);
    _hangarVisuals[i] = visual;
}
```

在 `_Input()` 中，炮塔空位检测之后添加机库空位检测：

```csharp
// ─── 检测机库空位点击 ───
for (int i = 0; i < HangarSlotCount; i++)
{
    if (_installedHangars[i] != null) continue;
    if (_hangarVisuals[i] == null || !_hangarVisuals[i].Visible) continue;

    if (_hangarVisuals[i].ContainsWorldPoint(mouseWorldPos))
    {
        OpenHangarMenu(i);
        GetViewport().SetInputAsHandled();
        return;
    }
}
```

添加机库菜单和建造方法：

```csharp
// ─────────── 机库交互 ───────────

/// <summary>当前菜单对应的机库插槽索引（-1 表示无菜单）</summary>
private int _hangarMenuSlotIndex = -1;

/// <summary>
/// 打开机库建造菜单
/// </summary>
private void OpenHangarMenu(int slotIndex)
{
    _hangarMenuSlotIndex = slotIndex;

    Vector2 slotWorldPos = _hangarVisuals[slotIndex].GlobalPosition;
    var canvasTransform = GetViewport().GetCanvasTransform();
    Vector2 screenPos = canvasTransform * slotWorldPos;
    screenPos += new Vector2(60, -20);

    // 复用炮塔菜单，但显示机库选项
    // 注意：TurretMenu 需要扩展支持机库类型，或者创建独立的 HangarMenu
    // 当前简单处理：直接建造，跳过菜单（调试阶段）
    BuildHangar(slotIndex);
}

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
```

- [ ] **Step 2: 修改 Mothership.tscn — 添加 HangarBay 占位节点**

在 Mothership.tscn 末尾（MainCannon 节点后）添加 4 个 HangarBay 占位节点：

```
[ext_resource type="Script" path="res://scripts/Mothership/HangarBay.cs" id="7_hangar"]

[node name="HangarBay_0" type="Node2D" parent="."]
script = ExtResource("7_hangar")

[node name="HangarBay_1" type="Node2D" parent="."]
script = ExtResource("7_hangar")

[node name="HangarBay_2" type="Node2D" parent="."]
script = ExtResource("7_hangar")

[node name="HangarBay_3" type="Node2D" parent="."]
script = ExtResource("7_hangar")
```

注意：HangarBay 的实际位置由 TurretSlotManager 在代码中管理，此处 .tscn 中的节点只是 Godot 编辑器的视觉占位。实际机库实例由 TurretSlotManager.BuildHangar() 动态创建。

**实际上不需要在 .tscn 中预放 HangarBay 节点**，因为 HangarBay 是动态创建的（类似炮塔）。删除上面的 .tscn 修改，机库完全由 TurretSlotManager 代码管理。

- [ ] **Step 3: 编译验证**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded

- [ ] **Step 4: 提交**

```bash
git add scripts/Mothership/TurretSlotManager.cs
git commit -m "feat: TurretSlotManager 扩展支持机库插槽（4个后部位置）"
```

---

## Task 7: 添加调试快捷键

**Files:**
- Modify: `scripts/Core/Main.cs`

- [ ] **Step 1: 修改 Main.cs — 添加机库相关调试快捷键**

在类顶部添加引用和字段：

```csharp
using OtrasShip.Mothership;
```

在 `_Input()` 的调试模式 switch 中，`case Key.Key8` 之后添加：

```csharp
// 按 9：在母舰后部建造一个机库（不花资源）
case Key.Key9:
    BuildDebugHangar();
    break;
// 按 0：召回所有战斗机
case Key.Key0:
    RecallAllFighters();
    break;
```

在 `UpdateDebugUI()` 中，更新调试提示文本：

```csharp
label.Text = $"[调试模式] SHIFT+T 退出 | 1:碰撞({collisionStatus}) | 2:敌人 | 3:批量敌人 | 4:空雷 | 5:散布空雷 | 6:陨石 | 7:批量陨石 | 8:战舰 | 9:机库 | 0:召回";
```

在类末尾添加调试方法：

```csharp
// ─────────── 机库调试 ───────────

/// <summary>
/// 调试：在母舰后部建造一个机库（不消耗资源）。
/// 找到第一个空的机库插槽并直接建造。
/// </summary>
private void BuildDebugHangar()
{
    var mothership = GetNodeOrNull<Node2D>("Mothership");
    var slotManager = mothership?.GetNodeOrNull<TurretSlotManager>("TurretSlotManager");
    if (slotManager == null)
    {
        GD.PrintErr("[Main] 未找到 TurretSlotManager");
        return;
    }

    // 找到第一个空的机库插槽
    for (int i = 0; i < TurretSlotManager.HangarSlotCount; i++)
    {
        // 直接调用 BuildHangar（内部会扣资源，调试时我们传入免费资源）
        // 简单做法：先给资源再建造
        if (ResourceManager.Instance != null)
        {
            ResourceManager.Instance.AddResource(TurretSlotManager.HangarBuildCost);
        }
        slotManager.BuildHangar(i);
        GD.Print($"[Main] 调试建造机库 {i}");
        return;
    }

    GD.Print("[Main] 所有机库插槽已满");
}

/// <summary>
/// 调试：召回所有机库的战斗机
/// </summary>
private void RecallAllFighters()
{
    var mothership = GetNodeOrNull<Node2D>("Mothership");
    var slotManager = mothership?.GetNodeOrNull<TurretSlotManager>("TurretSlotManager");
    slotManager?.RecallAllFighters();
    GD.Print("[Main] 已发出召回指令");
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded

- [ ] **Step 3: 提交**

```bash
git add scripts/Core/Main.cs
git commit -m "feat: 添加调试快捷键 9（建造机库）和 0（召回战斗机）"
```

---

## Task 8: 编译运行与手动验收

- [ ] **Step 1: 完整编译**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip
dotnet build OtrasShip.csproj
```

Expected: Build succeeded, 0 warnings

- [ ] **Step 2: 运行游戏并手动验收**

```bash
/home/liufei/data/godot/Godot_v4.4.1-stable_mono_linux.x86_64 --path /home/liufei/data/claude-workspace/OtrasShip
```

验收清单：
1. 按 Shift+T 进入调试模式
2. 按 9 → 应在母舰后部建造一个机库，4 架绿色战斗机出发
3. 按 2 生成敌方战斗机 → 友方战斗机应自动追击并射击
4. 观察战斗机血条 — 被敌方子弹命中时血量下降
5. 等战斗机血量低于 30% → 应自动返航，到达母舰后消失
6. 等待 10s → 机库应重新生成一架满血战斗机
7. 按 0 → 所有战斗机应返航

- [ ] **Step 3: 修复问题（如有）**

根据手动测试结果修复发现的问题，每个修复单独提交。

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: 阶段7 战斗机与机库系统完成"
```

---

## 文件变更总结

| 文件 | 操作 | 职责 |
|------|------|------|
| `assets/sprites/player_fighter.png` | 新建 | 友方战斗机占位图 |
| `project.godot` | 修改 | 新增层9 player_fighter |
| `scripts/Core/GameConstants.cs` | 修改 | 新增 PlayerFighterCollisionLayer 常量 |
| `scripts/AI/FighterAI.cs` | 新建 | 友方战斗机 AI 状态机 |
| `scripts/Fighter/Fighter.cs` | 新建 | 友方战斗机实体 |
| `scenes/Fighter.tscn` | 新建 | 友方战斗机场景 |
| `scripts/Mothership/HangarBay.cs` | 新建 | 机库管理器 |
| `scripts/Mothership/TurretSlotManager.cs` | 修改 | 扩展机库插槽支持 |
| `scripts/Core/Main.cs` | 修改 | 新增调试快捷键 9、0 |
