using Godot;

/// <summary>
/// 全局游戏管理器，作为 Godot 自动加载单例使用。
/// 负责管理游戏状态、分数、生命周期等全局数据。
/// </summary>
public partial class GameManager : Node
{
    public override void _Ready()
    {
        GD.Print("GameManager initialized");
    }
}
