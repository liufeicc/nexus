using Godot;

/// <summary>
/// 星舰主体控制。
/// 管理星舰视觉绘制（使用 CanvasItem 自定义绘制，替代 ColorRect）和主炮功能。
/// 挂在 Node2D 节点上。
/// </summary>
[GlobalClass]
public partial class Starship : Node2D
{
    // ========== 主炮参数 ==========

    /// <summary>射击间隔（秒）</summary>
    [Export] public float FireRate = 0.2f;

    /// <summary>子弹伤害</summary>
    [Export] public float Damage = 75f;

    /// <summary>主炮 HP</summary>
    [Export] public float MaxHp = 300f;

    /// <summary>子弹预制体路径</summary>
    [Export] public string BulletScenePath = "res://scenes/Bullet.tscn";

    /// <summary>主炮当前位置（相对于星舰根节点）</summary>
    private Vector2 _turretPosition = new(50, 0);

    // ========== 星舰 HP ==========

    /// <summary>星舰最大 HP</summary>
    [Export] public float ShipMaxHp = 1000f;

    /// <summary>星舰当前 HP</summary>
    private float _currentHp = 1000f;

    // ========== 主炮私有字段 ==========

    /// <summary>主炮当前 HP</summary>
    private float _turretHp;

    /// <summary>射击冷却计时器</summary>
    private float _fireTimer = 0f;

    /// <summary>主炮是否被摧毁</summary>
    private bool _isTurretDestroyed = false;

    /// <summary>主炮旋转角度</summary>
    private float _turretAngle = 0f;

    /// <summary>子弹预制体引用</summary>
    private PackedScene? _bulletScene;

    // ========== Signals ==========

    [Signal]
    public delegate void ShipDamagedEventHandler(float currentHp, float maxHp);
    [Signal]
    public delegate void TurretDamagedEventHandler(float currentHp, float maxHp);
    [Signal]
    public delegate void TurretDestroyedEventHandler();

    public override void _Ready()
    {
        _turretHp = MaxHp;
        _bulletScene = GD.Load<PackedScene>(BulletScenePath);
        _currentHp = ShipMaxHp;

        // 触发一次绘制
        QueueRedraw();
    }

    public override void _Process(double delta)
    {
        // 主炮跟随鼠标旋转
        if (!_isTurretDestroyed)
        {
            Vector2 mousePos = GetGlobalMousePosition();
            _turretAngle = (mousePos - GlobalPosition).Angle();
        }

        // 射击冷却
        _fireTimer -= (float)delta;

        // 点击左键射击
        if (Input.IsActionJustPressed("fire") && _fireTimer <= 0f && !_isTurretDestroyed)
        {
            Fire();
            _fireTimer = FireRate;
        }
    }

    public override void _Draw()
    {
        // 绘制星舰主体：300x100 矩形，中心在原点
        var bodyColor = new Color(0.29f, 0.33f, 0.4f, 1f);
        var bodyRect = new Rect2(-150, -50, 300, 100);
        DrawRect(bodyRect, bodyColor);

        // 绘制引擎：20x40 矩形，位于左侧
        var engineColor = new Color(0.96f, 0.54f, 0.33f, 1f);
        var engineRect = new Rect2(-160, -20, 20, 40);
        DrawRect(engineRect, engineColor);

        // 绘制主炮（旋转后的炮管）
        if (!_isTurretDestroyed)
        {
            var barrelColor = new Color(0.96f, 0.26f, 0.26f, 1f);
            // 炮管从主炮位置向右延伸 40 像素，宽 8 像素
            var barrelRect = new Rect2(0, -4, 40, 8);
            DrawSetTransform(_turretPosition, _turretAngle, Vector2.One);
            DrawRect(barrelRect, barrelColor);
            DrawSetTransform(Vector2.Zero, 0, Vector2.One);
        }
    }

    /// <summary>
    /// 开火：实例化子弹并设置初始方向和位置
    /// </summary>
    private void Fire()
    {
        if (_bulletScene == null || _isTurretDestroyed) return;

        Node2D bullet = _bulletScene.Instantiate<Node2D>();
        GetTree().Root.AddChild(bullet);

        // 子弹方向 = 主炮朝向
        Vector2 direction = new Vector2(Mathf.Cos(_turretAngle), Mathf.Sin(_turretAngle));

        // 子弹从主炮位置发射（世界坐标）
        Vector2 worldTurretPos = GlobalPosition + _turretPosition;
        if (bullet is Bullet b)
        {
            b.Init(direction, Damage, worldTurretPos);
        }
    }

    /// <summary>
    /// 星舰受到伤害
    /// </summary>
    public void TakeDamage(float amount)
    {
        _currentHp -= amount;
        EmitSignal(SignalName.ShipDamaged, _currentHp, ShipMaxHp);

        GD.Print($"[Starship] 受到伤害 {amount:F0}，剩余 HP: {_currentHp:F0}/{ShipMaxHp:F0}");

        if (_currentHp <= 0f)
        {
            GD.Print("[Starship] 星舰被摧毁！");
            QueueFree();
        }
    }

    /// <summary>
    /// 主炮受到伤害
    /// </summary>
    public void TakeTurretDamage(float amount)
    {
        if (_isTurretDestroyed) return;

        _turretHp -= amount;
        EmitSignal(SignalName.TurretDamaged, _turretHp, MaxHp);

        if (_turretHp <= 0f)
        {
            DestroyTurret();
        }
    }

    /// <summary>
    /// 主炮被摧毁
    /// </summary>
    private void DestroyTurret()
    {
        _isTurretDestroyed = true;
        EmitSignal(SignalName.TurretDestroyed);
        QueueRedraw();
    }
}
