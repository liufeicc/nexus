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
