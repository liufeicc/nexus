using Godot;

/// <summary>
/// 主炮控制。
/// 跟随鼠标 360 度旋转，点击左键射击。
/// 挂在 Node2D 上，子节点包含炮管 Sprite 和射击点。
/// </summary>
[GlobalClass]
public partial class MainTurret : Node2D
{
    /// <summary>射击间隔（秒）</summary>
    [Export] public float FireRate = 0.2f;

    /// <summary>子弹伤害</summary>
    [Export] public float Damage = 75f;

    /// <summary>主炮 HP</summary>
    [Export] public float MaxHp = 300f;

    /// <summary>子弹预制体路径</summary>
    [Export] public string BulletScenePath = "res://scenes/Bullet.tscn";

    /// <summary>主炮 HP</summary>
    private float _currentHp;

    /// <summary>射击冷却计时器</summary>
    private float _fireTimer = 0f;

    /// <summary>是否被摧毁</summary>
    private bool _isDestroyed = false;

    /// <summary>子弹预制体引用</summary>
    private PackedScene? _bulletScene;

    // ========== Signals ==========

    [Signal]
    public delegate void TurretDamagedEventHandler(float currentHp, float maxHp);

    [Signal]
    public delegate void TurretDestroyedEventHandler();

    public override void _Ready()
    {
        _currentHp = MaxHp;
        _bulletScene = GD.Load<PackedScene>(BulletScenePath);
    }

    public override void _Process(double delta)
    {
        if (_isDestroyed) return;

        // 获取鼠标在世界坐标中的位置
        Vector2 mousePos = GetGlobalMousePosition();

        // 计算主炮到鼠标的角度
        float angle = (mousePos - GlobalPosition).Angle();

        // 设置旋转
        Rotation = angle;

        // 射击冷却
        _fireTimer -= (float)delta;

        // 点击左键射击
        if (Input.IsActionJustPressed("fire") && _fireTimer <= 0f)
        {
            Fire();
            _fireTimer = FireRate;
        }
    }

    /// <summary>
    /// 开火：实例化子弹并设置初始方向和位置
    /// </summary>
    private void Fire()
    {
        if (_bulletScene == null || _isDestroyed) return;

        Node2D bullet = _bulletScene.Instantiate<Node2D>();
        GetTree().Root.AddChild(bullet);

        // 子弹方向 = 主炮朝向
        Vector2 direction = new Vector2(Mathf.Cos(Rotation), Mathf.Sin(Rotation));

        // 子弹从主炮位置发射
        if (bullet is Bullet b)
        {
            b.Init(direction, Damage, GlobalPosition);
        }
    }

    /// <summary>
    /// 受到伤害
    /// </summary>
    public void TakeDamage(float amount)
    {
        if (_isDestroyed) return;

        _currentHp -= amount;
        EmitSignal(SignalName.TurretDamaged, _currentHp, MaxHp);

        if (_currentHp <= 0f)
        {
            Destroy();
        }
    }

    /// <summary>
    /// 主炮被摧毁
    /// </summary>
    private void Destroy()
    {
        _isDestroyed = true;
        EmitSignal(SignalName.TurretDestroyed);
        Visible = false;
        SetProcess(false);
    }
}
