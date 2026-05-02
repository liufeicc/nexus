using Godot;

/// <summary>
/// 直线弹体。
/// 挂在 Area2D 节点上，沿发射方向匀速移动，超出边界或碰撞后销毁。
/// </summary>
[GlobalClass]
public partial class Bullet : Area2D
{
    /// <summary>子弹速度（像素/秒）</summary>
    [Export] public float Speed = 600f;

    /// <summary>子弹伤害</summary>
    [Export] public float Damage = 25f;

    /// <summary>移动方向（归一化）</summary>
    private Vector2 _direction = Vector2.Right;

    /// <summary>是否已标记销毁</summary>
    private bool _markedForDeletion = false;

    /// <summary>屏幕边界（用于检测出界）</summary>
    private float _screenWidth = 1280f;
    private float _screenHeight = 720f;

    public override void _Ready()
    {
        // 碰撞后触发回调
        BodyEntered += OnBodyEntered;
    }

    public override void _Process(double delta)
    {
        if (_markedForDeletion) return;

        // 沿方向移动
        Position += _direction * Speed * (float)delta;

        // 检查是否超出屏幕边界
        if (Position.X < -100 || Position.X > _screenWidth + 100 ||
            Position.Y < -100 || Position.Y > _screenHeight + 100)
        {
            QueueFree();
        }
    }

    /// <summary>
    /// 初始化子弹：设置方向、伤害、发射位置
    /// </summary>
    public void Init(Vector2 direction, float damage, Vector2 position)
    {
        _direction = direction.Normalized();
        Damage = damage;
        Position = position;
    }

    /// <summary>
    /// 碰撞回调：命中实体时扣血
    /// </summary>
    private void OnBodyEntered(Node2D body)
    {
        if (_markedForDeletion) return;
        _markedForDeletion = true;

        // 如果碰撞体有 TakeDamage 方法，调用它
        if (body.HasMethod("TakeDamage"))
        {
            body.Call("TakeDamage", Damage);
        }

        QueueFree();
    }
}
