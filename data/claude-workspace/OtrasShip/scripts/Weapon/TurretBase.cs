using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Weapon;

/// <summary>
/// 炮塔类型枚举 — 标识 4 种炮塔，用于 TurretSlotManager 配置。
/// </summary>
public enum TurretType
{
    None,       // 空插槽
    Bullet,     // 子弹炮塔
    Shotgun,    // 散弹炮塔
    Missile,    // 导弹炮塔
    Laser       // 激光炮塔
}

/// <summary>
/// 炮塔抽象基类 — 所有炮塔的公共逻辑。
/// 继承 EntityBase（Area2D），具备血量组件，可被摧毁。
/// 负责：目标选择、炮管旋转、冷却计时。
/// 子类只需实现 Fire() 和 CreateSprites() 即可。
///
/// 注意：炮塔通过代码创建（new BulletTurret() 等），没有 .tscn 场景文件，
/// 因此 CollisionShape2D 和 HealthComponent 需要在 _Ready() 中动态创建。
/// _Ready() 顺序关键：先创建组件，再调用 base._Ready()，才能正确挂钩信号。
/// </summary>
public abstract partial class TurretBase : EntityBase
{
    // ─────────── 配置参数 ───────────

    [Export] public float DetectionRange { get; set; } = 800f;   // 探测半径（像素）
    [Export] public float FireRate { get; set; } = 1f;           // 射击间隔（秒）
    [Export] public int Damage { get; set; } = 10;               // 基础伤害
    [Export] public float TurnSpeed { get; set; } = 8f;          // 炮管转向速率（弧度/秒）
    [Export] public float MuzzleOffset { get; set; } = 35f;      // 炮口距离（像素）

    /// <summary>炮塔最大血量（子类在 _Ready 中设置具体值，再调用 base._Ready()）</summary>
    [Export] public int TurretMaxHealth { get; set; } = 100;

    /// <summary>
    /// 目标组名称列表 — 炮塔会扫描这些组中的节点作为攻击目标。
    /// 玩家炮塔默认攻击敌人组（enemy_fighter、space_mine、asteroid）；
    /// 敌方战舰炮塔可设置为攻击母舰组（mothership）。
    /// </summary>
    [Export] public string[] TargetGroups { get; set; } = new string[]
    {
        "enemy_fighter", "space_mine", "asteroid", "enemy_battleship"
    };

    // ─────────── 敌我标识 ───────────

    /// <summary>
    /// 是否为敌方炮塔 — 影响子弹类型、目标组、射线掩码和外观颜色。
    /// false = 玩家炮塔（母舰上），true = 敌方炮塔（大型战舰上）。
    /// 由创建方在 AddChild 之前设置（因为 AddChild 触发 _Ready）。
    /// </summary>
    public bool IsEnemy { get; set; } = false;

    // ─────────── 插槽与类型标识 ───────────

    /// <summary>炮塔所在的插槽索引（-1 表示未安装），由 TurretSlotManager 安装时设置</summary>
    public int SlotIndex { get; set; } = -1;

    /// <summary>炮塔类型标识（子类在 _Ready 中设置）</summary>
    public TurretType Type { get; protected set; } = TurretType.None;

    // ─────────── 信号 ───────────

    /// <summary>炮塔被摧毁时发出，参数为插槽索引（用于通知 TurretSlotManager）</summary>
    [Signal] public delegate void TurretDiedEventHandler(int slotIndex);

    // ─────────── 内部状态 ───────────

    protected float _fireCooldown = 0f;         // 射击冷却计时
    protected Node2D _currentTarget = null;     // 当前锁定的目标
    protected Sprite2D _barrelSprite;           // 炮管精灵（需要独立旋转）

    // ─────────── 调试可视化 ───────────

    private Line2D _debugRange;                 // 探测范围圆圈
    private Line2D _debugAimLine;               // 瞄准线（炮管方向到探测范围）

    // ─────────── 生命周期 ───────────

    /// <summary>
    /// 初始化顺序（关键）：
    /// 1. 创建 HealthComponent 并 AddChild — 必须在 base._Ready() 之前，
    ///    因为 EntityBase._Ready() 通过 GetNodeOrNull 查找并挂钩 Died 信号
    /// 2. 创建 CollisionShape2D 并 AddChild — 使炮塔在物理世界中可被检测
    /// 3. 设置碰撞层 — layer 8（turret），mask 0（炮塔不检测其他物体）
    /// 4. 调用 base._Ready() — EntityBase 挂钩 HealthComponent.Died 信号
    /// 5. 调用 CreateSprites() — 子类创建各自的精灵
    /// 6. 添加 HealthBar — 依赖 HealthComponent 已作为同级存在
    /// 7. 创建调试可视化节点
    /// </summary>
    public override void _Ready()
    {
        // ─── 1. 创建 HealthComponent（必须在 base._Ready() 之前）───
        var healthComponent = new HealthComponent();
        healthComponent.Name = "HealthComponent";
        healthComponent.MaxHealth = TurretMaxHealth;
        AddChild(healthComponent);

        // ─── 2. 创建 CollisionShape2D（圆形，半径 18px）───
        var collisionShape = new CollisionShape2D();
        collisionShape.Name = "CollisionShape";
        var circleShape = new CircleShape2D();
        circleShape.Radius = 18f;
        collisionShape.Shape = circleShape;
        AddChild(collisionShape);

        // ─── 3. 设置碰撞层 ───
        // layer 8 (turret) = 位值 128，使 EnemyBullet 可以通过 mask 检测到此炮塔
        // mask = 0：炮塔本身不检测碰撞，只被动被检测
        CollisionLayer = GameConstants.TurretCollisionLayer;
        CollisionMask = 0;

        // ─── 4. 调用 base._Ready()（EntityBase 查找 HealthComponent 并挂钩 Died 信号）───
        base._Ready();

        // ─── 5. 子类创建各自的精灵（底座 + 炮管）───
        CreateSprites();

        // ─── 6. 添加血量显示条（HealthBar 查找同级 HealthComponent）───
        var healthBar = new HealthBar();
        healthBar.Name = "HealthBar";
        AddChild(healthBar);

        // ─── 7. 调试可视化 ───
        _debugRange = new Line2D();
        _debugRange.Name = "DebugRange";
        _debugRange.Width = 1.5f;
        _debugRange.DefaultColor = new Color(0f, 0.8f, 0f, 0.3f);  // 绿色半透明
        _debugRange.Visible = false;
        _debugRange.AddToGroup(DebugManager.DebugGroup);
        GetTree().Root.CallDeferred(Node.MethodName.AddChild, _debugRange);

        _debugAimLine = new Line2D();
        _debugAimLine.Name = "DebugAimLine";
        _debugAimLine.Width = 2f;
        _debugAimLine.DefaultColor = new Color(1f, 1f, 0f, 0.5f);  // 黄色半透明
        _debugAimLine.Visible = false;
        _debugAimLine.AddToGroup(DebugManager.DebugGroup);
        GetTree().Root.CallDeferred(Node.MethodName.AddChild, _debugAimLine);
    }

    public override void _ExitTree()
    {
        // 清理调试节点
        if (_debugRange != null && IsInstanceValid(_debugRange))
            _debugRange.QueueFree();
        if (_debugAimLine != null && IsInstanceValid(_debugAimLine))
            _debugAimLine.QueueFree();
    }

    public override void _Process(double delta)
    {
        float dt = (float)delta;

        // 已死亡时跳过所有逻辑（OnDied 会 QueueFree，但可能在下一帧才执行）
        if (Health != null && Health.IsDead) return;

        // 冷却计时
        if (_fireCooldown > 0)
            _fireCooldown -= dt;

        // 目标选择
        UpdateTarget();

        // 有目标时旋转炮管并尝试射击
        if (_currentTarget != null)
        {
            AimAtTarget(_currentTarget);

            if (_fireCooldown <= 0 && IsTargetInFireCone(_currentTarget))
            {
                Fire();
                _fireCooldown = FireRate;
            }
        }

        // 调试可视化
        UpdateDebugRange();
        UpdateDebugAimLine();
    }

    // ─────────── 死亡处理 ───────────

    /// <summary>
    /// 重写死亡处理 — 发射 TurretDied 信号通知 TurretSlotManager，然后销毁
    /// </summary>
    protected override void OnDied()
    {
        GD.Print($"[{EntityName}] 炮塔被摧毁（插槽 {SlotIndex}）");

        // 通知 TurretSlotManager 清理插槽
        EmitSignal(SignalName.TurretDied, SlotIndex);

        base.OnDied();  // EntityBase 默认调用 QueueFree()
    }

    // ─────────── 目标选择 ───────────

    /// <summary>
    /// 更新当前目标 — 扫描 enemy_fighter 和 space_mine 组，选择探测范围内最近的敌人。
    /// 如果当前目标超出探测范围或已死亡，清空并重新选择。
    /// </summary>
    protected void UpdateTarget()
    {
        // 检查当前目标是否仍有效（存活且在范围内）
        if (_currentTarget != null)
        {
            if (!IsInstanceValid(_currentTarget)
                || IsTargetDead(_currentTarget)
                || IsTargetOutOfRange(_currentTarget))
            {
                _currentTarget = null;
            }
        }

        // 无目标时搜索新目标
        if (_currentTarget == null)
        {
            _currentTarget = FindNearestEnemy();
        }
    }

    /// <summary>
    /// 在探测范围内搜索最近的敌人。
    /// 扫描 TargetGroups 配置的所有组，选择距离最近的存活目标。
    /// 距离测量使用 GetShapeDistanceTo()：取目标碰撞形状边缘最近点，
    /// 而非目标中心，确保大体积目标（如母舰）的射程判定更准确。
    /// </summary>
    protected Node2D FindNearestEnemy()
    {
        Node2D nearest = null;
        float minDist = DetectionRange + 1f;  // 加 1px 容差，避免边界距离恰好等于射程时选不到目标

        // 遍历配置的目标组
        foreach (string groupName in TargetGroups)
        {
            var members = GetTree().GetNodesInGroup(groupName);
            foreach (var node in members)
            {
                if (node is not Node2D target) continue;
                if (IsTargetDead(target)) continue;

                // 使用碰撞形状距离，而非中心点距离
                float dist = CollisionShapeHelper.GetShapeDistanceTo(GlobalPosition, target);
                if (dist < minDist)
                {
                    minDist = dist;
                    nearest = target;
                }
            }
        }

        return nearest;
    }

    /// <summary>
    /// 检查目标是否已死亡（通用判断，支持有 HealthComponent、_triggered 或 _isDestroyed 标记的节点）
    /// </summary>
    private bool IsTargetDead(Node2D target)
    {
        // 有血量组件的节点（敌机、炮塔等）
        var health = target.GetNodeOrNull<HealthComponent>("HealthComponent");
        if (health != null)
            return health.IsDead;

        // 空雷：用 _triggered 字段判断（反射获取，避免强引用 Enemy 命名空间）
        var triggeredField = target.Get("_triggered");
        if (triggeredField.VariantType == Variant.Type.Bool && triggeredField.AsBool())
            return true;

        // 陨石：用 _isDestroyed 字段判断
        var destroyedField = target.Get("_isDestroyed");
        if (destroyedField.VariantType == Variant.Type.Bool && destroyedField.AsBool())
            return true;

        return false;
    }

    /// <summary>
    /// 检查目标是否超出探测范围（超出即判定丢失，立即重新选择）。
    /// 使用碰撞形状距离：大体积目标（如母舰）的边缘在射程内即视为在范围内。
    /// </summary>
    private bool IsTargetOutOfRange(Node2D target)
    {
        float dist = CollisionShapeHelper.GetShapeDistanceTo(GlobalPosition, target);
        return dist > DetectionRange;
    }

    // ─────────── 瞄准 ───────────

    /// <summary>
    /// 炮管平滑旋转朝向目标
    /// </summary>
    protected void AimAtTarget(Node2D target)
    {
        if (_barrelSprite == null) return;

        Vector2 direction = target.GlobalPosition - GlobalPosition;
        float targetAngle = direction.Angle();

        // 计算角度差并归一化到 [-PI, PI]
        float angleDiff = targetAngle - _barrelSprite.Rotation;
        while (angleDiff > Mathf.Pi) angleDiff -= Mathf.Tau;
        while (angleDiff < -Mathf.Pi) angleDiff += Mathf.Tau;

        // 限幅转向（每帧最多转 TurnSpeed × dt 弧度）
        float maxTurn = TurnSpeed * (float)GetProcessDeltaTime();
        float turn = Mathf.Clamp(angleDiff, -maxTurn, maxTurn);
        _barrelSprite.Rotation += turn;
    }

    /// <summary>
    /// 检查目标是否在炮管射击锥内（炮管朝向与目标方向夹角 < 10°）
    /// </summary>
    protected bool IsTargetInFireCone(Node2D target)
    {
        if (_barrelSprite == null) return false;

        Vector2 toTarget = (target.GlobalPosition - GlobalPosition).Normalized();
        Vector2 barrelDir = new Vector2(1, 0).Rotated(_barrelSprite.Rotation);

        // 点积 > cos(10°) ≈ 0.985 表示夹角 < 10°
        float dot = toTarget.Dot(barrelDir);
        return dot > 0.985f;
    }

    // ─────────── 子类必须实现的方法 ───────────

    /// <summary>
    /// 执行射击 — 子类实现具体武器逻辑
    /// </summary>
    protected abstract void Fire();

    /// <summary>
    /// 创建炮塔精灵（底座 + 炮管）— 子类重写，使用 PlaceholderArt 创建占位图
    /// </summary>
    protected abstract void CreateSprites();

    // ─────────── 辅助方法 ───────────

    /// <summary>
    /// 获取炮口世界坐标（沿炮管方向偏移 MuzzleOffset）
    /// </summary>
    protected Vector2 GetMuzzlePosition()
    {
        if (_barrelSprite == null) return GlobalPosition;
        Vector2 direction = new Vector2(1, 0).Rotated(_barrelSprite.Rotation);
        return GlobalPosition + direction * MuzzleOffset;
    }

    /// <summary>
    /// 获取炮管朝向方向向量
    /// </summary>
    protected Vector2 GetBarrelDirection()
    {
        if (_barrelSprite == null) return Vector2.Right;
        return new Vector2(1, 0).Rotated(_barrelSprite.Rotation);
    }

    /// <summary>
    /// 调试：绘制探测范围圆圈（protected 以便子类重写 _Process 时调用）
    /// </summary>
    protected void UpdateDebugRange()
    {
        if (_debugRange == null) return;

        bool shouldShow = DebugManager.IsDebugMode && DebugManager.ShowCollisions;
        _debugRange.Visible = shouldShow;
        if (!shouldShow) return;

        _debugRange.ClearPoints();
        int segments = 24;
        for (int i = 0; i <= segments; i++)
        {
            float angle = (float)i / segments * Mathf.Tau;
            Vector2 point = GlobalPosition + new Vector2(
                Mathf.Cos(angle) * DetectionRange,
                Mathf.Sin(angle) * DetectionRange
            );
            _debugRange.AddPoint(point);
        }
    }

    /// <summary>
    /// 调试：绘制瞄准线（从炮塔中心沿炮管方向）并控制炮管精灵可见性
    /// </summary>
    protected void UpdateDebugAimLine()
    {
        bool isDebug = DebugManager.IsDebugMode;

        // 炮管精灵只在调试模式下显示
        if (_barrelSprite != null)
        {
            _barrelSprite.Visible = isDebug;
        }

        if (_debugAimLine == null) return;

        // 瞄准线只在调试模式且显示碰撞时绘制
        bool shouldShow = isDebug && DebugManager.ShowCollisions;
        _debugAimLine.Visible = shouldShow;
        if (!shouldShow) return;

        _debugAimLine.ClearPoints();
        _debugAimLine.AddPoint(GlobalPosition);

        // 有目标时画到目标方向，否则画炮管朝向
        Vector2 endPos;
        if (_currentTarget != null && IsInstanceValid(_currentTarget))
        {
            endPos = _currentTarget.GlobalPosition;
        }
        else
        {
            endPos = GlobalPosition + GetBarrelDirection() * DetectionRange;
        }
        _debugAimLine.AddPoint(endPos);
    }

    /// <summary>
    /// 设置炮管初始朝向（用于敌方炮塔默认朝左等场景）。
    /// 只在没有锁定目标时生效（有目标后 AimAtTarget 会接管旋转）。
    /// </summary>
    public void SetBarrelRotation(float rotation)
    {
        if (_barrelSprite != null)
        {
            _barrelSprite.Rotation = rotation;
        }
    }
}
