using Godot;

/// <summary>
/// 敌人生成器。
/// 读取 WaveData 资源，按波次和间隔生成敌人。
/// 挂在 Node2D 上，需要指定生成区域和敌人预制体。
/// </summary>
[GlobalClass]
public partial class EnemySpawner : Node2D
{
    /// <summary>波次数据资源路径</summary>
    [Export] public string WaveDataPath = "res://resources/wave_1.tres";

    /// <summary>敌人预制体路径</summary>
    [Export] public string EnemyScenePath = "res://scenes/Enemy.tscn";

    /// <summary>生成位置的 X 坐标（屏幕右侧外）</summary>
    [Export] public float SpawnX = 1350f;

    /// <summary>波次间隔（秒）</summary>
    [Export] public float WaveInterval = 5f;

    /// <summary>当前波次数据</summary>
    private WaveData? _waveData;

    /// <summary>敌人预制体</summary>
    private PackedScene? _enemyScene;

    /// <summary>当前波次索引</summary>
    private int _currentWaveIndex = 0;

    /// <summary>当前波次中已生成的敌人数量</summary>
    private int _spawnedInWave = 0;

    /// <summary>生成间隔计时器</summary>
    private float _spawnTimer = 0f;

    /// <summary>波次间等待计时器</summary>
    private float _waveTimer = 0f;

    /// <summary>是否正在等待下一波</summary>
    private bool _waitingForNextWave = false;

    /// <summary>当前存活的敌人数量</summary>
    private int _activeEnemies = 0;

    /// <summary>是否所有波次已完成</summary>
    private bool _allWavesComplete = false;

    /// <summary>GameManager 引用</summary>
    private GameManager? _gameManager;

    public override void _Ready()
    {
        _gameManager = GetNode<GameManager>("/root/GameManager");
        _waveData = LoadOrCreateWaveData();
        _enemyScene = GD.Load<PackedScene>(EnemyScenePath);

        if (_enemyScene == null)
        {
            GD.PrintErr($"[EnemySpawner] 无法加载敌人预制体: {EnemyScenePath}");
            return;
        }

        GD.Print($"[EnemySpawner] 加载关卡 {_waveData!.LevelName}，共 {_waveData!.Waves.Count} 波");

        // 开始第一波
        StartWave();
    }

    public override void _Process(double delta)
    {
        if (_waveData == null || _enemyScene == null || _allWavesComplete) return;

        if (_waitingForNextWave)
        {
            _waveTimer -= (float)delta;
            if (_waveTimer <= 0f)
            {
                _waitingForNextWave = false;
                StartWave();
            }
            return;
        }

        // 在当前波次内生成敌人
        var currentWave = _waveData.Waves[_currentWaveIndex];
        if (_spawnedInWave < currentWave.EnemyCount)
        {
            _spawnTimer -= (float)delta;
            if (_spawnTimer <= 0f)
            {
                SpawnEnemy(currentWave);
                _spawnedInWave++;
                _spawnTimer = currentWave.SpawnInterval;
            }
        }
        else if (_activeEnemies <= 0)
        {
            // 当前波次所有敌人生成完毕且全部被消灭
            WaveComplete();
        }
    }

    /// <summary>
    /// 尝试加载波次数据，失败时创建默认配置
    /// </summary>
    private WaveData? LoadOrCreateWaveData()
    {
        var data = GD.Load<WaveData>(WaveDataPath);
        if (data != null) return data;

        GD.Print($"[EnemySpawner] 波次数据 {WaveDataPath} 不存在，使用默认配置");

        // 创建默认波次
        var defaultData = new WaveData
        {
            LevelNumber = 1,
            LevelName = "第一关",
            LevelReward = 200
        };

        // 第一波
        var wave1 = new WaveConfig
        {
            EnemyCount = 5,
            SpawnInterval = 2.0f,
            SpawnYRange = 150f
        };
        defaultData.Waves.Add(wave1);

        // 第二波
        var wave2 = new WaveConfig
        {
            EnemyCount = 8,
            SpawnInterval = 1.5f,
            SpawnYRange = 200f
        };
        defaultData.Waves.Add(wave2);

        return defaultData;
    }

    /// <summary>
    /// 开始新波次
    /// </summary>
    private void StartWave()
    {
        _currentWaveIndex = Mathf.Min(_currentWaveIndex, _waveData!.Waves.Count - 1);
        var wave = _waveData.Waves[_currentWaveIndex];

        GD.Print($"[EnemySpawner] 开始第 {_currentWaveIndex + 1} 波，敌人数量: {wave.EnemyCount}");

        _spawnedInWave = 0;
        _spawnTimer = 0.5f; // 第一只敌人延迟 0.5 秒出现

        _gameManager!.StartWave(_currentWaveIndex + 1);
    }

    /// <summary>
    /// 生成单个敌人
    /// </summary>
    private void SpawnEnemy(WaveConfig wave)
    {
        var enemy = _enemyScene!.Instantiate<Enemy>();

        // 随机 Y 位置
        float spawnY = GlobalPosition.Y + (float)GD.RandRange(-wave.SpawnYRange, wave.SpawnYRange);
        enemy.GlobalPosition = new Vector2(SpawnX, spawnY);

        // 订阅死亡事件
        enemy.Connect("enemy_died", Callable.From((int reward) => OnEnemyDied()));

        GetTree().Root.AddChild(enemy);
        _activeEnemies++;

        GD.Print($"[EnemySpawner] 生成敌人 #{_spawnedInWave + 1}，位置: ({SpawnX:F0}, {spawnY:F0})");
    }

    /// <summary>
    /// 敌人死亡回调
    /// </summary>
    private void OnEnemyDied()
    {
        _activeEnemies--;
    }

    /// <summary>
    /// 波次完成
    /// </summary>
    private void WaveComplete()
    {
        GD.Print($"[EnemySpawner] 第 {_currentWaveIndex + 1} 波完成！");
        _gameManager!.CompleteWave(_currentWaveIndex + 1);

        _currentWaveIndex++;

        if (_currentWaveIndex >= _waveData!.Waves.Count)
        {
            // 所有波次完成
            _allWavesComplete = true;
            GD.Print("[EnemySpawner] 所有波次完成！关卡胜利！");
            _gameManager.AddResources(_waveData.LevelReward);
            _gameManager.CompleteLevel();
        }
        else
        {
            // 等待下一波
            _waitingForNextWave = true;
            _waveTimer = WaveInterval;
        }
    }
}
