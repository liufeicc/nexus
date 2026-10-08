using Godot;

/// <summary>
/// 敌人基类。
/// 挂在 Area2D 节点上。管理 HP、移动、死亡和资源掉落。
/// 具体敌人继承此脚本或通过配置覆盖参数。
/// </summary>
[GlobalClass]
public partial class Enemy : Area2D
{
    /// <summary>最大 HP</summary>
    [Export] public float MaxHp = 100f;

    /// <summary>移动速度（像素/秒）</summary>
    [Export] public float MoveSpeed = 80f;

    /// <summary>死亡时掉落的资源数量</summary>
    [Export] public int ResourceReward = 50;

    /// <summary>当前 HP</summary>
    private float _currentHp;

    /// <summary>是否已被标记销毁</summary>
    private bool _isDead = false;

    // ========== Signals ==========

    [Signal]
    public delegate void EnemyDamagedEventHandler(float currentHp, float maxHp);

    [Signal]
    public delegate void EnemyDiedEventHandler(int resourceReward);

    public override void _Ready()
    {
        _currentHp = MaxHp;

        // 被子弹碰撞时触发
        BodyEntered += OnBodyEntered;
        AreaEntered += OnAreaEntered;

        // 触发绘制
        QueueRedraw();
    }

    public override void _Draw()
    {
        // 绘制 50x50 红色半透明方块，中心在原点
        var color = new Color(0.96f, 0.26f, 0.26f, 0.7f);
        var rect = new Rect2(-25, -25, 50, 50);
        DrawRect(rect, color);
    }

    public override void _Process(double delta)
    {
        // 从右向左移动
        Position += Vector2.Left * MoveSpeed * (float)delta;

        // 超出左边界后销毁
        if (Position.X < -100)
        {
            QueueFree();
        }
    }

    /// <summary>
    /// 受到伤害
    /// </summary>
    public void TakeDamage(float amount)
    {
        if (_isDead) return;

        _currentHp -= amount;
        EmitSignal(SignalName.EnemyDamaged, _currentHp, MaxHp);

        GD.Print($"[{Name}] 受到伤害 {amount:F0}，剩余 HP: {_currentHp:F0}/{MaxHp:F0}");

        if (_currentHp <= 0f)
        {
            Die();
        }
    }

    /// <summary>
    /// 敌人死亡
    /// </summary>
    private void Die()
    {
        _isDead = true;
        GD.Print($"[{Name}] 被击毁！掉落资源: {ResourceReward}");

        // 通知 GameManager 增加资源
        var gameManager = GetNode<GameManager>("/root/GameManager");
        gameManager.AddResources(ResourceReward);

        // 发送死亡信号
        EmitSignal(SignalName.EnemyDied, ResourceReward);

        // 销毁
        QueueFree();
    }

    /// <summary>
    /// Area2D 碰撞回调（子弹是 Area2D）
    /// </summary>
    private void OnAreaEntered(Area2D area)
    {
        // Bullet 类通过 BodyEntered 处理，这里处理 Area2D 类型的碰撞
        if (area is Bullet bullet)
        {
            TakeDamage(bullet.Damage);
        }
    }

    /// <summary>
    /// 物理体碰撞回调
    /// </summary>
    private void OnBodyEntered(Node2D body)
    {
        // 如果碰撞的是子弹，已在 Bullet 的 OnBodyEntered 中处理
        // 这里留空，留给后续碰撞逻辑（如撞到星舰）
    }
}
