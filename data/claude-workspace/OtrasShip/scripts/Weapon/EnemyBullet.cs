using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Weapon;

/// <summary>
/// 敌方子弹 — 直线飞行，碰撞母舰时造成伤害。
/// 使用双重碰撞检测：Area2D 信号 + 手动距离检测（防止高速穿越）。
/// </summary>
public partial class EnemyBullet : Area2D
{
    // ─────────── 配置参数 ───────────

    [Export] public float Speed { get; set; } = 400f;
    [Export] public int Damage { get; set; } = 8;
    [Export] public float Lifetime { get; set; } = 5f;

    // ─────────── 状态 ───────────

    private Vector2 _direction = Vector2.Left;   // 默认向左飞行（朝母舰）
    private float _age = 0f;
    private bool _hasHit = false;  // 防止手动检测和 Area2D 信号同时触发造成双倍伤害

    /// <summary>子弹是否已命中目标（供散弹炮塔检查，避免双重伤害）</summary>
    public bool HasHit => _hasHit;

    /// <summary>子弹是否处于活跃状态（对象池控制）</summary>
    private bool _isActive = false;

    /// <summary>
    /// 子弹是否从母舰内部发射。
    /// 内部发射的子弹跳过母舰边缘穿越检测（CheckManualHit），
    /// 避免飞出母舰时误伤船体。只通过 CheckTurretHit 检测炮塔命中。
    /// </summary>
    public bool FiredInsideMothership { get; set; } = false;

    private Vector2 _prevPos;  // 上一帧位置

    // ─────────── 缓存引用（_Ready 中初始化，避免每帧路径查找）───────────
    private Node2D _mothership;
    private HealthComponent _mothershipHealth;

    // ─────────── 调试可视化 ───────────
    private Line2D _debugBoundary;  // 母舰边界线

    // ─────────── 初始化 ───────────

    /// <summary>
    /// 初始化子弹（由发射者调用）
    /// </summary>
    public void Initialize(Vector2 direction, int damage = 0, float speed = 0)
    {
        _direction = direction.Normalized();
        Rotation = _direction.Angle();
        _prevPos = GlobalPosition;  // 重置上一帧位置，用于线段穿越检测

        if (damage > 0) Damage = damage;
        if (speed > 0) Speed = speed;
    }

    /// <summary>
    /// 激活子弹（由对象池调用）— 设为可见并启用物理处理和碰撞监测
    /// </summary>
    public void Activate()
    {
        _isActive = true;
        Visible = true;
        Monitoring = true;
        SetPhysicsProcess(true);
    }

    /// <summary>
    /// 重置子弹状态（由对象池回收时调用）
    /// </summary>
    public void ResetState()
    {
        _isActive = false;
        _age = 0f;
        _hasHit = false;
        FiredInsideMothership = false;
    }

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        // 子弹挂在 BulletPool 节点下（Autoload），在场景树中排在 Main 之前。
        // 设置较高 ZIndex，确保子弹渲染在母舰和敌舰上方。
        ZIndex = 10;

        var sprite = new Sprite2D();
        sprite.Name = "Sprite";
        sprite.Texture = GD.Load<Texture2D>("res://assets/sprites/enemy_bullet.png");
        AddChild(sprite);

        _prevPos = GlobalPosition;

        AreaEntered += OnAreaEntered;

        // 缓存母舰引用，避免每帧路径查找
        _mothership = GetTree().Root.GetNodeOrNull<Node2D>("Main/Mothership");
        _mothershipHealth = _mothership?.GetNodeOrNull<HealthComponent>("HealthComponent");

        // ─── 调试可视化：创建 Line2D 显示母舰边界 ───
        _debugBoundary = new Line2D();
        _debugBoundary.Name = "DebugBoundary";
        _debugBoundary.Width = 3f;
        _debugBoundary.DefaultColor = new Color(1f, 0f, 0f, 0.8f);  // 红色
        _debugBoundary.Visible = false;
        _debugBoundary.AddToGroup(DebugManager.DebugGroup);
        GetTree().Root.AddChild(_debugBoundary);
    }

    public override void _ExitTree()
    {
        // 清理调试可视化节点（挂载在场景根节点，不会随子弹自动销毁）
        if (_debugBoundary != null && IsInstanceValid(_debugBoundary))
            _debugBoundary.QueueFree();
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!_isActive) return;

        float dt = (float)delta;

        _prevPos = GlobalPosition;
        GlobalPosition += _direction * Speed * dt;

        // ─── 优先检测炮塔命中（重叠检测）───
        // 战斗机在母舰内部射击时，子弹可能同时重叠炮塔和穿越母舰边缘，
        // 炮塔命中优先级高于母舰边缘命中。
        if (CheckTurretHit())
        {
            BulletPool.Instance.Return(this);
            return;
        }

        // ─── 友方战斗机命中检测 ───
        if (CheckFighterHit())
        {
            BulletPool.Instance.Return(this);
            return;
        }

        // ─── 母舰边缘穿越检测（仅外部发射的子弹）───
        // 内部发射的子弹飞出母舰时会穿越边缘，不应触发船体伤害
        if (!FiredInsideMothership && CheckManualHit())
        {
            BulletPool.Instance.Return(this);
            return;
        }

        // ─── 调试：绘制母舰边界 ───
        UpdateDebugBoundary();

        _age += dt;
        if (_age >= Lifetime)
        {
            BulletPool.Instance.Return(this);
        }
    }

    // ─────────── 碰撞检测 ───────────

    /// <summary>
    /// 炮塔命中检测 — 仅在子弹从母舰内部发射时（FiredInsideMothership=true）执行。
    /// 使用 GetOverlappingAreas() 查找当前位置重叠的炮塔。
    /// 筛选条件：碰撞层包含 turret 层（layer 8，位值 256），且有存活的 HealthComponent。
    /// 命中后对炮塔造成伤害并标记 _hasHit，子弹由调用方回收。
    ///
    /// 注意：大型战舰从外部发射的子弹不执行此检测，
    /// 否则子弹会被母舰上的友方炮塔拦截，无法到达母舰船体。
    /// </summary>
    private bool CheckTurretHit()
    {
        if (_hasHit) return false;

        // 只有从母舰内部发射的子弹才需要检测炮塔
        // （敌方战斗机突入母舰内部射击时，子弹需要击中内部炮塔）
        // 大型战舰从外部发射的子弹跳过此检测，直接飞向母舰船体
        if (!FiredInsideMothership) return false;

        // 获取当前子弹位置重叠的所有 Area2D
        var areas = GetOverlappingAreas();
        foreach (var area in areas)
        {
            if (area == null || !IsInstanceValid(area)) continue;
            if (area == this) continue;

            // 筛选炮塔层（layer 8，位值 256）
            if ((area.CollisionLayer & GameConstants.TurretCollisionLayer) == 0) continue;

            // 查找 HealthComponent 并造成伤害
            var health = area.GetNodeOrNull<Entity.HealthComponent>("HealthComponent");
            if (health != null && !health.IsDead)
            {
                _hasHit = true;
                health.TakeDamage(Damage);
                return true;
            }
        }

        return false;
    }

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

    /// <summary>
    /// 线段-矩形边界穿越检测 — 检测子弹本帧移动轨迹是否穿过母舰矩形的4条边。
    /// 母舰碰撞体为 960×480 矩形，子弹穿越任意一条边即命中。
    /// 母舰无旋转，直接用轴对齐矩形。
    /// </summary>
    private bool CheckManualHit()
    {
        if (_hasHit) return false;
        if (_mothership == null || !IsInstanceValid(_mothership)) return false;

        Vector2 mPos = _mothership.GlobalPosition;
        // 母舰矩形的4条边界（世界坐标）
        float left   = mPos.X - GameConstants.MothershipHalfSize.X;
        float right  = mPos.X + GameConstants.MothershipHalfSize.X;
        float top    = mPos.Y - GameConstants.MothershipHalfSize.Y;
        float bottom = mPos.Y + GameConstants.MothershipHalfSize.Y;

        Vector2 from = _prevPos;
        Vector2 to   = GlobalPosition;

        // 检测线段是否穿越了矩形的任意一条边
        // 左边缘: x = left, y 在 [top, bottom] 范围内
        if (CrossesVerticalEdge(from, to, left, top, bottom)) return DoHit();
        // 右边缘: x = right, y 在 [top, bottom] 范围内
        if (CrossesVerticalEdge(from, to, right, top, bottom)) return DoHit();
        // 上边缘: y = top, x 在 [left, right] 范围内
        if (CrossesHorizontalEdge(from, to, top, left, right)) return DoHit();
        // 下边缘: y = bottom, x 在 [left, right] 范围内
        if (CrossesHorizontalEdge(from, to, bottom, left, right)) return DoHit();

        return false;
    }

    /// <summary>
    /// 调试：绘制母舰碰撞边界（红色矩形）
    /// </summary>
    private void UpdateDebugBoundary()
    {
        if (_debugBoundary == null) return;

        // 只在调试模式且显示碰撞时绘制
        bool shouldShow = DebugManager.IsDebugMode && DebugManager.ShowCollisions;
        _debugBoundary.Visible = shouldShow;
        if (!shouldShow) return;

        if (_mothership == null || !IsInstanceValid(_mothership)) return;

        Vector2 mPos = _mothership.GlobalPosition;
        float left   = mPos.X - GameConstants.MothershipHalfSize.X;
        float right  = mPos.X + GameConstants.MothershipHalfSize.X;
        float top    = mPos.Y - GameConstants.MothershipHalfSize.Y;
        float bottom = mPos.Y + GameConstants.MothershipHalfSize.Y;

        // 绘制矩形边界（5个点形成闭合矩形）
        _debugBoundary.ClearPoints();
        _debugBoundary.AddPoint(new Vector2(left, top));
        _debugBoundary.AddPoint(new Vector2(right, top));
        _debugBoundary.AddPoint(new Vector2(right, bottom));
        _debugBoundary.AddPoint(new Vector2(left, bottom));
        _debugBoundary.AddPoint(new Vector2(left, top));  // 闭合
    }

    /// <summary>
    /// 检测线段 (from→to) 是否穿越垂直边 x=edgeX，且穿越点 y 在 [yMin, yMax] 范围内
    /// </summary>
    private bool CrossesVerticalEdge(Vector2 from, Vector2 to, float edgeX, float yMin, float yMax)
    {
        // 线段两端在边的两侧
        if ((from.X < edgeX) == (to.X < edgeX)) return false;
        // 计算穿越点的 Y 坐标
        float t = (edgeX - from.X) / (to.X - from.X);
        float crossY = from.Y + t * (to.Y - from.Y);
        return crossY >= yMin && crossY <= yMax;
    }

    /// <summary>
    /// 检测线段 (from→to) 是否穿越水平边 y=edgeY，且穿越点 x 在 [xMin, xMax] 范围内
    /// </summary>
    private bool CrossesHorizontalEdge(Vector2 from, Vector2 to, float edgeY, float xMin, float xMax)
    {
        if ((from.Y < edgeY) == (to.Y < edgeY)) return false;
        float t = (edgeY - from.Y) / (to.Y - from.Y);
        float crossX = from.X + t * (to.X - from.X);
        return crossX >= xMin && crossX <= xMax;
    }

    private bool DoHit()
    {
        _hasHit = true;
        if (_mothershipHealth != null && !_mothershipHealth.IsDead)
        {
            _mothershipHealth.TakeDamage(Damage);
        }
        return true;
    }

    /// <summary>
    /// Area2D 信号碰撞回调（备用）。
    /// 只处理炮塔层（layer 8），且仅在子弹从母舰内部发射时执行。
    /// 母舰伤害统一由 CheckManualHit（边缘穿越检测）处理，
    /// 避免子弹进入母舰 Area2D 时通过信号路径误伤母舰。
    /// 大型战舰从外部发射的子弹跳过炮塔检测，防止被友方炮塔拦截。
    /// </summary>
    private void OnAreaEntered(Area2D area)
    {
        if (!_isActive) return;
        if (_hasHit) return;
        if (area == this) return;

        // 只处理从母舰内部发射的子弹的炮塔碰撞
        // 外部发射的子弹（如大型战舰）跳过炮塔检测
        if (!FiredInsideMothership) return;

        // 只处理炮塔层碰撞，跳过母舰（母舰伤害由 CheckManualHit 处理）
        if ((area.CollisionLayer & GameConstants.TurretCollisionLayer) == 0) return;

        var healthNode = area.GetNodeOrNull<HealthComponent>("HealthComponent");
        if (healthNode != null)
        {
            _hasHit = true;
            healthNode.TakeDamage(Damage);
            BulletPool.Instance.Return(this);
        }
    }
}
