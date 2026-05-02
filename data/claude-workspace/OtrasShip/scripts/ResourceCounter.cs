using Godot;

/// <summary>
/// 资源计数器。
/// 监听 GameManager 的资源变化事件，更新 HUD 显示。
/// 挂在 Label 节点上（HUD 内部的子节点）。
/// 注意：HUD.cs 已直接订阅了 GameManager 信号，此类为兼容计划保留。
/// </summary>
[GlobalClass]
public partial class ResourceCounter : Label
{
    private GameManager? _gameManager;

    public override void _Ready()
    {
        _gameManager = GetNode<GameManager>("/root/GameManager");
        _gameManager.Connect("resources_changed", Callable.From((int amount) => UpdateDisplay(amount)));

        // 初始化显示
        UpdateDisplay(_gameManager.Resources);
    }

    private void UpdateDisplay(int amount)
    {
        Text = $"💎 {amount}";
    }
}
