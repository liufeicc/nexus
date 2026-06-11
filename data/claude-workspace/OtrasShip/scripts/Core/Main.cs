using Godot;
using OtrasShip.Enemy;
using OtrasShip.Mothership;

namespace OtrasShip.Core;

/// <summary>
/// Main 场景控制器 — 游戏入口场景。
/// 负责加载子场景（母舰、敌人等）并管理场景层级结构。
/// 阶段6：添加空雷和陨石测试生成逻辑。
/// </summary>
public partial class Main : Node2D
{
    // ─────────── 配置参数 ───────────

    [Export] public float SpawnInterval { get; set; } = 3f;     // 敌方战斗机生成间隔（秒）
    [Export] public int MaxEnemies { get; set; } = 5;            // 最大同时存在敌人数
    [Export] public bool AutoSpawn { get; set; } = false;        // 是否自动生成（默认关闭，调试模式手动生成）

    [Export(PropertyHint.File)]
    public string EnemyFighterScenePath { get; set; } = "res://scenes/EnemyFighter.tscn";

    [Export(PropertyHint.File)]
    public string SpaceMineScenePath { get; set; } = "res://scenes/SpaceMine.tscn";

    [Export(PropertyHint.File)]
    public string AsteroidScenePath { get; set; } = "res://scenes/Asteroid.tscn";

    [Export(PropertyHint.File)]
    public string EnemyBattleshipScenePath { get; set; } = "res://scenes/EnemyBattleship.tscn";

    // ─────────── 内部状态 ───────────

    private PackedScene _enemyFighterScene;
    private PackedScene _spaceMineScene;
    private PackedScene _asteroidScene;
    private PackedScene _enemyBattleshipScene;
    private float _spawnTimer = 0f;
    private int _currentEnemyCount = 0;
    private RandomNumberGenerator _rng = new();

    // FPS 显示
    private Label _fpsLabel;
    private CanvasLayer _fpsCanvasLayer;
    private float _fpsAccumulator = 0f;
    private int _fpsFrameCount = 0;

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        GD.Print("[Main] 场景加载完成");

        // 预加载敌方战斗机场景
        _enemyFighterScene = GD.Load<PackedScene>(EnemyFighterScenePath);
        if (_enemyFighterScene == null)
        {
            GD.PrintErr($"[Main] 无法加载敌方战斗机场景: {EnemyFighterScenePath}");
        }

        // 预加载空雷场景
        _spaceMineScene = GD.Load<PackedScene>(SpaceMineScenePath);
        if (_spaceMineScene == null)
        {
            GD.PrintErr($"[Main] 无法加载空雷场景: {SpaceMineScenePath}");
        }

        // 预加载陨石场景
        _asteroidScene = GD.Load<PackedScene>(AsteroidScenePath);
        if (_asteroidScene == null)
        {
            GD.PrintErr($"[Main] 无法加载陨石场景: {AsteroidScenePath}");
        }

        // 预加载大型战舰场景
        _enemyBattleshipScene = GD.Load<PackedScene>(EnemyBattleshipScenePath);
        if (_enemyBattleshipScene == null)
        {
            GD.PrintErr($"[Main] 无法加载大型战舰场景: {EnemyBattleshipScenePath}");
        }

        // 更新调试标签
        var label = GetNodeOrNull<Label>("UILayer/DebugLabel");
        if (label != null)
        {
            label.Text = "OtrasShip — 阶段7 战斗机与机库";
        }

        // 创建 FPS 显示标签（右上角，固定在屏幕空间）
        _fpsCanvasLayer = new CanvasLayer();
        _fpsCanvasLayer.Name = "FPSLayer";
        AddChild(_fpsCanvasLayer);

        _fpsLabel = new Label();
        _fpsLabel.Name = "FPSLabel";
        _fpsLabel.AddThemeFontSizeOverride("font_size", 18);
        _fpsLabel.AddThemeColorOverride("font_color", new Color(0f, 1f, 0f));
        _fpsLabel.Text = "FPS: --";
        _fpsLabel.HorizontalAlignment = HorizontalAlignment.Right;

        _fpsCanvasLayer.AddChild(_fpsLabel);

        // 设置位置（屏幕宽 - 估算标签宽 - 边距，确保完整显示）
        _fpsLabel.Position = new Vector2(GetViewportRect().Size.X - 150, 10);

        // 连接 NodeRemoved 信号，跟踪敌人数
        GetTree().NodeRemoved += OnNodeRemoved;
    }

    public override void _Process(double delta)
    {
        // ─── FPS 计算（每秒更新一次）───
        float dt = (float)delta;
        _fpsAccumulator += dt;
        _fpsFrameCount++;
        if (_fpsAccumulator >= 1f)
        {
            int fps = Mathf.RoundToInt(_fpsFrameCount / _fpsAccumulator);
            if (_fpsLabel != null)
                _fpsLabel.Text = $"FPS: {fps}";
            _fpsAccumulator = 0f;
            _fpsFrameCount = 0;
        }

        if (!AutoSpawn) return;

        _spawnTimer += dt;

        if (_spawnTimer >= SpawnInterval && _currentEnemyCount < MaxEnemies)
        {
            SpawnEnemyFighter();
            _spawnTimer = 0f;
        }
    }

    public override void _Input(InputEvent @event)
    {
        if (@event is InputEventKey key && key.Pressed)
        {
            // SHIFT+T：切换调试模式
            if (key.Keycode == Key.T && key.ShiftPressed)
            {
                DebugManager.ToggleDebugMode();
                UpdateDebugUI();
                return;
            }

            // 调试模式下的快捷键
            if (DebugManager.IsDebugMode)
            {
                switch (key.Keycode)
                {
                    // 按 1：切换碰撞区域显示
                    case Key.Key1:
                        DebugManager.ToggleShowCollisions(GetTree());
                        UpdateDebugUI();
                        break;
                    // 按 2：生成敌方战斗机
                    case Key.Key2:
                        SpawnEnemyFighter();
                        break;
                    // 按 3：批量生成 5 个敌方战斗机（测试炮塔）
                    case Key.Key3:
                        for (int i = 0; i < 5; i++) SpawnEnemyFighter();
                        break;
                    // 按 4：在母舰前方生成空雷
                    case Key.Key4:
                        SpawnSpaceMine();
                        break;
                    // 按 5：在母舰周围散布 3 颗空雷
                    case Key.Key5:
                        for (int i = 0; i < 3; i++) SpawnSpaceMine();
                        break;
                    // 按 6：生成陨石
                    case Key.Key6:
                        SpawnAsteroid();
                        break;
                    // 按 7：批量生成 3 个陨石
                    case Key.Key7:
                        for (int i = 0; i < 3; i++) SpawnAsteroid();
                        break;
                    // 按 8：生成大型战舰
                    case Key.Key8:
                        SpawnEnemyBattleship();
                        break;
                    // 按 9：在母舰后部建造一个机库（不花资源）
                    case Key.Key9:
                        BuildDebugHangar();
                        break;
                    // 按 0：召回所有战斗机
                    case Key.Key0:
                        RecallAllFighters();
                        break;
                }
            }
        }
    }

    /// <summary>
    /// 更新调试模式 UI 显示
    /// </summary>
    private void UpdateDebugUI()
    {
        var label = GetNodeOrNull<Label>("UILayer/DebugLabel");
        if (label == null) return;

        if (!DebugManager.IsDebugMode)
        {
            label.Text = "OtrasShip — 阶段7 战斗机与机库";
            return;
        }

        // 调试模式下显示状态和操作提示
        var collisionStatus = DebugManager.ShowCollisions ? "显示" : "隐藏";
        label.Text = $"[调试模式] SHIFT+T 退出 | 1:碰撞({collisionStatus}) | 2:敌人 | 3:批量敌人 | 4:空雷 | 5:散布空雷 | 6:陨石 | 7:批量陨石 | 8:战舰 | 9:机库 | 0:召回";
    }

    // ─────────── 生成逻辑 ───────────

    /// <summary>
    /// 在母舰右侧随机位置生成一个敌方战斗机
    /// 生成距离靠近母舰（600~1200px），方便玩家瞄准测试
    /// </summary>
    private void SpawnEnemyFighter()
    {
        if (_enemyFighterScene == null)
        {
            GD.PrintErr("[Main] 敌方战斗机场景未加载");
            return;
        }

        var enemy = _enemyFighterScene.Instantiate<EnemyFighter>();

        // 从屏幕右侧外生成，确保敌人从视野外飞入
        var viewportSize = GetViewport().GetVisibleRect().Size;
        var camera = GetViewport().GetCamera2D();
        float cameraRight = camera != null ? camera.GlobalPosition.X : viewportSize.X / 2f;
        float spawnX = cameraRight + viewportSize.X / 2f + 100f;  // 屏幕右边缘外 100px
        float spawnY = _rng.RandfRange(viewportSize.Y * 0.15f, viewportSize.Y * 0.85f);

        enemy.GlobalPosition = new Vector2(spawnX, spawnY);
        AddChild(enemy);

        _currentEnemyCount++;
    }

    /// <summary>
    /// 跟踪敌人销毁事件，更新计数
    /// </summary>
    private void OnNodeRemoved(Node node)
    {
        if (node is EnemyFighter)
        {
            _currentEnemyCount--;
        }
    }

    // ─────────── 空雷生成 ───────────

    /// <summary>
    /// 在屏幕右侧外生成一颗空雷（静止不动，等母舰靠近）。
    /// 生成位置与敌方战斗机相同：摄像机视野右边缘外 100px。
    /// </summary>
    private void SpawnSpaceMine()
    {
        if (_spaceMineScene == null)
        {
            GD.PrintErr("[Main] 空雷场景未加载");
            return;
        }

        var mine = _spaceMineScene.Instantiate<SpaceMine>();

        // 从屏幕右侧外生成，确保空雷在视野外
        var viewportSize = GetViewport().GetVisibleRect().Size;
        var camera = GetViewport().GetCamera2D();
        float cameraRight = camera != null ? camera.GlobalPosition.X : viewportSize.X / 2f;
        float spawnX = cameraRight + viewportSize.X / 2f + 100f;  // 屏幕右边缘外 100px
        float spawnY = _rng.RandfRange(viewportSize.Y * 0.15f, viewportSize.Y * 0.85f);

        mine.GlobalPosition = new Vector2(spawnX, spawnY);
        AddChild(mine);
        GD.Print($"[Main] 空雷生成于 {mine.GlobalPosition}");
    }

    // ─────────── 陨石生成 ───────────

    /// <summary>
    /// 在屏幕右侧外生成一个陨石（静止不动，等待被射击分裂）。
    /// 生成位置与敌方战斗机相同：摄像机视野右边缘外 100px。
    /// </summary>
    private void SpawnAsteroid()
    {
        if (_asteroidScene == null)
        {
            GD.PrintErr("[Main] 陨石场景未加载");
            return;
        }

        var asteroid = _asteroidScene.Instantiate<Asteroid>();

        // 从屏幕右侧外生成，确保陨石在视野外
        var viewportSize = GetViewport().GetVisibleRect().Size;
        var camera = GetViewport().GetCamera2D();
        float cameraRight = camera != null ? camera.GlobalPosition.X : viewportSize.X / 2f;
        float spawnX = cameraRight + viewportSize.X / 2f + 100f;  // 屏幕右边缘外 100px
        float spawnY = _rng.RandfRange(viewportSize.Y * 0.15f, viewportSize.Y * 0.85f);

        asteroid.GlobalPosition = new Vector2(spawnX, spawnY);
        AddChild(asteroid);
        GD.Print($"[Main] 陨石生成于 {asteroid.GlobalPosition}");
    }

    // ─────────── 大型战舰生成 ───────────

    /// <summary>
    /// 在屏幕右侧外生成一艘大型战舰。
    /// 战舰会以缓慢速度从右侧进入画面，到达驻守位置后停下用炮塔攻击。
    /// </summary>
    private void SpawnEnemyBattleship()
    {
        if (_enemyBattleshipScene == null)
        {
            GD.PrintErr("[Main] 大型战舰场景未加载");
            return;
        }

        var battleship = _enemyBattleshipScene.Instantiate<Enemy.EnemyBattleship>();

        // 生成在屏幕右侧远处，让战舰有时间进入画面
        var viewportSize = GetViewport().GetVisibleRect().Size;
        var camera = GetViewport().GetCamera2D();
        float cameraRight = camera != null ? camera.GlobalPosition.X : viewportSize.X / 2f;
        float spawnX = cameraRight + viewportSize.X / 2f + 500f;  // 屏幕右边缘外 500px
        // 垂直位置随机：基于相机 Y 居中位置计算可见范围
        // canvas_items 模式下相机 Y=0，世界坐标可见范围约 -540~+540
        // 战舰高 180px（半高 90），范围 -350~+350 确保完整可见
        float cameraCenterY = camera != null ? camera.GlobalPosition.Y : 0f;
        float halfVisible = viewportSize.Y / 2f;
        float margin = 90f; // 战舰半高
        float spawnY = _rng.RandfRange(
            cameraCenterY - halfVisible + margin,
            cameraCenterY + halfVisible - margin
        );

        battleship.GlobalPosition = new Vector2(spawnX, spawnY);
        AddChild(battleship);
        GD.Print($"[Main] 大型战舰生成于 {battleship.GlobalPosition}");
    }

    // ─────────── 机库调试 ───────────

    /// <summary>
    /// 调试：在母舰后部建造一个机库（不消耗资源）。
    /// 先补充资源再建造，确保免费。
    /// </summary>
    private void BuildDebugHangar()
    {
        var mothership = GetNodeOrNull<Node2D>("Mothership");
        var slotManager = mothership?.GetNodeOrNull<TurretSlotManager>("TurretSlotManager");
        if (slotManager == null)
        {
            GD.PrintErr("[Main] 未找到 TurretSlotManager");
            return;
        }

        // 尝试建造第一个可用的机库插槽
        for (int i = 0; i < TurretSlotManager.HangarSlotCount; i++)
        {
            if (ResourceManager.Instance != null)
            {
                ResourceManager.Instance.AddResource(TurretSlotManager.HangarBuildCost);
            }
            if (slotManager.BuildHangar(i))
            {
                GD.Print($"[Main] 调试建造机库 {i}");
                return;
            }
        }
        GD.Print("[Main] 所有机库插槽已满");
    }

    /// <summary>
    /// 调试：召回所有机库的战斗机
    /// </summary>
    private void RecallAllFighters()
    {
        var mothership = GetNodeOrNull<Node2D>("Mothership");
        var slotManager = mothership?.GetNodeOrNull<TurretSlotManager>("TurretSlotManager");
        slotManager?.RecallAllFighters();
        GD.Print("[Main] 已发出召回指令");
    }
}
