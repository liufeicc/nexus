using Godot;

/// <summary>
/// 全局单例，通过 AutoLoad 加载。
/// 管理游戏状态、全局事件广播、跨场景数据。
/// </summary>
[GlobalClass]
public partial class GameManager : Node
{
    /// <summary>游戏状态枚举</summary>
    public enum GameState
    {
        Menu,       // 主菜单
        Playing,    // 战斗中
        Paused,     // 暂停
        LevelComplete, // 关卡完成
        GameOver    // 游戏结束
    }

    /// <summary>当前游戏状态</summary>
    private GameState _currentState = GameState.Menu;
    public GameState CurrentState
    {
        get => _currentState;
        set
        {
            _currentState = value;
            EmitSignal(SignalName.GameStateChanged, (int)value);
        }
    }

    /// <summary>玩家拥有的资源数量</summary>
    private int _resources = 0;
    public int Resources
    {
        get => _resources;
        set
        {
            _resources = value;
            EmitSignal(SignalName.ResourcesChanged, value);
        }
    }

    // ========== Signals ==========

    [Signal]
    public delegate void GameStateChangedEventHandler(GameState newState);

    [Signal]
    public delegate void ResourcesChangedEventHandler(int newAmount);

    [Signal]
    public delegate void WaveStartedEventHandler(int waveNumber);

    [Signal]
    public delegate void WaveCompletedEventHandler(int waveNumber);

    [Signal]
    public delegate void LevelCompletedEventHandler();

    [Signal]
    public delegate void GameOverEventHandler();

    // ========== 公共方法 ==========

    /// <summary>
    /// 增加资源
    /// </summary>
    public void AddResources(int amount)
    {
        _resources += amount;
        EmitSignal(SignalName.ResourcesChanged, _resources);
    }

    /// <summary>
    /// 花费资源，返回是否成功
    /// </summary>
    public bool SpendResources(int amount)
    {
        if (_resources >= amount)
        {
            _resources -= amount;
            EmitSignal(SignalName.ResourcesChanged, _resources);
            return true;
        }
        return false;
    }

    /// <summary>
    /// 开始新波次
    /// </summary>
    public void StartWave(int waveNumber)
    {
        EmitSignal(SignalName.WaveStarted, waveNumber);
    }

    /// <summary>
    /// 完成当前波次
    /// </summary>
    public void CompleteWave(int waveNumber)
    {
        EmitSignal(SignalName.WaveCompleted, waveNumber);
    }

    /// <summary>
    /// 关卡完成
    /// </summary>
    public void CompleteLevel()
    {
        CurrentState = GameState.LevelComplete;
        EmitSignal(SignalName.LevelCompleted);
    }

    /// <summary>
    /// 游戏结束
    /// </summary>
    public void EndGame()
    {
        CurrentState = GameState.GameOver;
        EmitSignal(SignalName.GameOver);
    }
}
