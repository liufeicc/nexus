using Godot;

/// <summary>
/// 相机拖动控制。
/// 鼠标右键按下并拖动时移动 Camera2D，限制在指定范围内。
/// 挂在 Camera2D 节点上。
/// </summary>
[GlobalClass]
public partial class CameraPull : Camera2D
{
    /// <summary>X 轴最大偏移距离（向右拉动）</summary>
    [Export] public float MaxOffsetX = 400f;

    /// <summary>Y 轴最大偏移距离（上下调整）</summary>
    [Export] public float MaxOffsetY = 200f;

    /// <summary>拖动灵敏度</summary>
    [Export] public float DragSensitivity = 1.0f;

    /// <summary>相机原始位置</summary>
    private Vector2 _originalPosition;

    /// <summary>当前偏移量</summary>
    private Vector2 _currentOffset = Vector2.Zero;

    /// <summary>是否正在拖动</summary>
    private bool _isDragging = false;

    /// <summary>上次鼠标位置</summary>
    private Vector2 _lastMousePosition;

    public override void _Ready()
    {
        _originalPosition = Position;
    }

    public override void _Process(double delta)
    {
        // 检测相机拖动输入（鼠标右键）
        if (Input.IsActionJustPressed("camera_drag"))
        {
            _isDragging = true;
            _lastMousePosition = GetGlobalMousePosition();
        }

        if (Input.IsActionJustReleased("camera_drag"))
        {
            _isDragging = false;
        }

        if (_isDragging)
        {
            Vector2 currentMouse = GetGlobalMousePosition();
            Vector2 deltaMouse = currentMouse - _lastMousePosition;

            // 反向移动相机（鼠标向右拉，相机向右移，画面左移）
            _currentOffset += deltaMouse * DragSensitivity;

            // 限制偏移范围
            _currentOffset = _currentOffset with
            {
                X = Mathf.Clamp(_currentOffset.X, 0, MaxOffsetX),
                Y = Mathf.Clamp(_currentOffset.Y, -MaxOffsetY, MaxOffsetY)
            };

            // 应用偏移
            Position = _originalPosition + _currentOffset;

            _lastMousePosition = currentMouse;
        }
    }
}
