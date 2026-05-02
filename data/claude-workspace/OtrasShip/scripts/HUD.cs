using Godot;

/// <summary>
/// 游戏 HUD 控制。
/// 显示星舰 HP、波次、资源等信息。
/// 挂在 CanvasLayer 节点上。
/// </summary>
[GlobalClass]
public partial class HUD : CanvasLayer
{
    private Label? _waveLabel;
    private Label? _resourceLabel;
    private ProgressBar? _shipHpBar;
    private Label? _shipHpLabel;
    private GameManager? _gameManager;

    /// <summary>星舰当前 HP</summary>
    private float _shipHp = 1000f;

    /// <summary>星舰最大 HP</summary>
    private float _shipMaxHp = 1000f;

    /// <summary>当前波次</summary>
    private int _currentWave = 0;

    public override void _Ready()
    {
        // 获取节点引用
        _waveLabel = GetNode<Label>("Control/WaveLabel");
        _resourceLabel = GetNode<Label>("Control/ResourceLabel");
        _shipHpBar = GetNode<ProgressBar>("Control/ShipHpBar");
        _shipHpLabel = GetNode<Label>("Control/ShipHpLabel");

        _gameManager = GetNode<GameManager>("/root/GameManager");

        // 订阅全局事件
        _gameManager.Connect("wave_started", Callable.From((int wave) => OnWaveStarted(wave)));
        _gameManager.Connect("resources_changed", Callable.From((int amount) => OnResourcesChanged(amount)));
        _gameManager.Connect("level_completed", Callable.From(OnLevelCompleted));

        // 初始化
        UpdateWaveDisplay();
        UpdateResourceDisplay(_gameManager.Resources);
        UpdateHpDisplay();
    }

    private void OnWaveStarted(int wave)
    {
        _currentWave = wave;
        UpdateWaveDisplay();
    }

    private void OnResourcesChanged(int amount)
    {
        UpdateResourceDisplay(amount);
    }

    private void OnLevelCompleted()
    {
        if (_waveLabel != null)
        {
            _waveLabel.Text = "🎉 关卡胜利！";
        }
        if (_resourceLabel != null)
        {
            _resourceLabel.Text = "通关奖励已发放";
        }
    }

    private void UpdateWaveDisplay()
    {
        if (_waveLabel != null)
        {
            _waveLabel.Text = $"波次: {_currentWave}";
        }
    }

    private void UpdateResourceDisplay(int amount)
    {
        if (_resourceLabel != null)
        {
            _resourceLabel.Text = $"💎 {amount}";
        }
    }

    private void UpdateHpDisplay()
    {
        if (_shipHpBar != null)
        {
            _shipHpBar.Value = _shipHp;
            _shipHpBar.MaxValue = _shipMaxHp;
        }
        if (_shipHpLabel != null)
        {
            _shipHpLabel.Text = $"{_shipHp:F0} / {_shipMaxHp:F0}";
        }
    }

    /// <summary>
    /// 更新星舰 HP（由星舰组件调用）
    /// </summary>
    public void UpdateShipHp(float current, float max)
    {
        _shipHp = current;
        _shipMaxHp = max;
        UpdateHpDisplay();
    }
}
