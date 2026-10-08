# Phase 1-2: 核心玩法可玩原型 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个可运行的 Godot 4.x C# 游戏原型，包含星舰、主炮射击、敌人波次、资源收集。

**Architecture:** 节点驱动 + 数据资源。主场景包含相机、星舰子场景、敌人生成器和 HUD。GameManager 作为 AutoLoad 单例管理全局状态。武器和波次配置用 Resource 类。

**Tech Stack:** Godot 4.x, C# (.NET 8), Godot Signals

---

## 文件结构总览

```
OtrasShip/
├── project.godot                    # Godot 项目配置（含 AutoLoad）
├── OtrasShip.csproj                 # C# 项目文件
├── icon.svg                         # Godot 默认图标
│
├── scripts/
│   ├── GameManager.cs               # AutoLoad 单例，全局状态
│   ├── CameraPull.cs                # 相机拖动控制
│   ├── MainTurret.cs                # 主炮跟随鼠标+射击
│   ├── Bullet.cs                    # Area2D 子弹
│   ├── Enemy.cs                     # 敌人基类
│   ├── EnemySpawner.cs              # 波次敌人生成
│   ├── ResourceCounter.cs           # 资源计数管理
│   └── HUD.cs                       # 游戏 UI 控制
│
├── scenes/
│   ├── Main.tscn                    # 主场景
│   ├── Starship.tscn                # 星舰子场景
│   └── HUD.tscn                     # HUD 场景
│
├── resources/
│   ├── WaveData.cs                  # 波次数据 Resource 类
│   └── wave_1.tres                  # 第一关波次配置
│
└── assets/                          # 预留，存放图片素材
```

---

### Task 1: 创建 Godot C# 项目骨架

**目标:** 项目能启动，Godot 识别为有效 C# 项目。

**依赖:** 无（首个任务）

#### 步骤

- [ ] **Step 1.1: 创建 project.godot**

创建 `project.godot`，这是 Godot 项目的入口配置文件。

```ini
; engine.cfg
config_version=5

[application]
config/name="OtrasStarship"
run/main_scene="res://scenes/Main.tscn"
config/features=PackedStringArray("4.3", "C#")

[autoload]
GameManager="*res://scripts/GameManager.cs"

[display]
window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"

[input]
fire={
"deadzone": 0.2,
"events": [Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":1,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":1,"canceled":false,"pressed":true,"double_click":false,"echo":false,"script":null)]
}
camera_drag={
"deadzone": 0.2,
"events": [Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":4,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":3,"canceled":false,"pressed":true,"double_click":false,"echo":false,"script":null)]
}

[layer_names]
2d_physics/layer_1="starship"
2d_physics/layer_2="enemies"
2d_physics/layer_3="bullets"
```

关键点：
- `run/main_scene` 指向主场景
- `autoload` 注册 GameManager 为全局单例
- 定义了 `fire`（鼠标左键）和 `camera_drag`（鼠标右键）输入动作
- 2D 物理图层分层：星舰、敌人、子弹

- [ ] **Step 1.2: 创建 OtrasShip.csproj**

```xml
<Project Sdk="Godot.NET.Sdk/4.3.0">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <TargetFramework Condition=" '$(GodotTargetPlatform)' == 'android' ">net8.0</TargetFramework>
    <TargetFramework Condition=" '$(GodotTargetPlatform)' == 'ios' ">net8.0</TargetFramework>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <RootNamespace>OtrasStarship</RootNamespace>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
```

- [ ] **Step 1.3: 创建目录结构**

```bash
mkdir -p scripts scenes resources assets
```

- [ ] **Step 1.4: 创建默认 icon.svg**

Godot 需要一个图标文件。创建一个简单的 SVG：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect width="128" height="128" fill="#363d52"/>
  <circle cx="64" cy="64" r="40" fill="#478cbf"/>
</svg>
```

- [ ] **Step 1.5: 还原 NuGet 依赖**

```bash
cd /home/liufei/data/claude-workspace/OtrasShip && dotnet restore
```

预期输出: 成功还原 Godot.NET.Sdk 包。

- [ ] **Step 1.6: 验证项目结构**

```bash
ls -la project.godot OtrasShip.csproj scripts/ scenes/ resources/
```

- [ ] **Step 1.7: 提交**

```bash
git add project.godot OtrasShip.csproj icon.svg scripts/ scenes/ resources/ assets/
git commit -m "chore: scaffold Godot 4.x C# project structure for Otras Starship"
```

---

### Task 2: GameManager 全局单例

**目标:** AutoLoad 单例，管理游戏状态和全局事件。

**文件:**
- 创建: `scripts/GameManager.cs`

- [ ] **Step 2.1: 创建 GameManager**

```csharp
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
            EmitSignal(SignalName.GameStateChanged, value);
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
    public delegate void GameStateStateChangedEventHandler(GameState newState);

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
```

- [ ] **Step 2.2: 编译验证**

```bash
dotnet build
```

预期: BUILD SUCCEEDED，无错误无警告。

- [ ] **Step 2.3: 提交**

```bash
git add scripts/GameManager.cs
git commit -m "feat: add GameManager autoload singleton with state and resource management"
```

---

### Task 3: 主场景与相机拖动

**目标:** 主场景包含相机和占位符星舰，鼠标右键拖动相机，有边界限制。

**文件:**
- 创建: `scenes/Main.tscn`
- 创建: `scripts/CameraPull.cs`
- 创建: `scripts/GameManager.cs`（已存在，Task 2 已创建）

- [ ] **Step 3.1: 创建 CameraPull.cs**

```csharp
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
```

关键点：
- 使用 `GetGlobalMousePosition()` 获取世界坐标
- 偏移量限制：X 只能向右 (0 ~ MaxOffsetX)，Y 可上下 (-MaxOffsetY ~ MaxOffsetY)
- 反向拖动：鼠标向右拉，相机跟随，效果是画面往左移

- [ ] **Step 3.2: 创建 scenes/Main.tscn**

Godot 场景文件是文本格式，使用 INI-like 语法：

```ini
[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://scripts/CameraPull.cs" id="1"]
[ext_resource type="Script" path="res://scripts/GameManager.cs" id="2"]

[node name="Main" type="Node2D"]

[node name="Background" type="ParallaxBackground" parent="."]

[node name="ParallaxLayer" type="ParallaxLayer" parent="Background"]

[node name="Stars" type="ColorRect" parent="Background/ParallaxLayer"]
offset_left = -500.0
offset_top = -500.0
offset_right = 2000.0
offset_bottom = 1500.0
color = Color(0.04, 0.04, 0.18, 1)

[node name="Camera2D" type="Camera2D" parent="."]
script = ExtResource("1")

[node name="StarshipHolder" type="Node2D" parent="."]
position = Vector2(200, 360)

[node name="ShipPlaceholder" type="ColorRect" parent="StarshipHolder"]
offset_left = -150.0
offset_top = -50.0
offset_right = 150.0
offset_bottom = 50.0
color = Color(0.29, 0.33, 0.4, 1)

[node name="TurretPlaceholder" type="ColorRect" parent="StarshipHolder"]
offset_left = 0.0
offset_top = -20.0
offset_right = 20.0
offset_bottom = 20.0
color = Color(0.96, 0.26, 0.26, 1)
```

说明：
- 主场景包含：星空背景（占位色块）、Camera2D（挂 CameraPull 脚本）、星舰占位符
- 星舰在 (200, 360) 位置，即屏幕左侧中间
- 星舰主体为深灰色矩形，主炮为红色小方块

- [ ] **Step 3.3: 编译验证**

```bash
dotnet build
```

- [ ] **Step 3.4: 提交**

```bash
git add scenes/Main.tscn scripts/CameraPull.cs
git commit -m "feat: add main scene with camera pull control and placeholder starship"
```

---

### Task 4: 主炮跟随鼠标与射击

**目标:** 主炮跟随鼠标旋转，点击左键发射子弹。

**文件:**
- 创建: `scripts/MainTurret.cs`
- 创建: `scripts/Bullet.cs`
- 修改: `scenes/Main.tscn`（更新星舰结构）
- 创建: `scenes/Starship.tscn`

- [ ] **Step 4.1: 创建 Bullet.cs**

```csharp
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
```

- [ ] **Step 4.2: 创建 MainTurret.cs**

```csharp
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
        // 隐藏炮塔
        Visible = false;
        SetProcess(false);
    }
}
```

关键点：
- `GetGlobalMousePosition()` 获取世界坐标，计算相对角度
- `Rotation = angle` 使炮管跟随鼠标
- 子弹通过 `GetTree().Root.AddChild()` 添加到根节点，不受父节点变换影响
- 使用 `PackedScene.Instantiate<Node2D>()` 动态实例化

- [ ] **Step 4.3: 创建 Bullet 场景 scenes/Bullet.tscn**

```ini
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/Bullet.cs" id="1"]

[node name="Bullet" type="Area2D"]
collision_layer = 4
collision_mask = 2
script = ExtResource("1")

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]

[node name="Sprite" type="ColorRect" parent="."]
offset_left = -6.0
offset_top = -3.0
offset_right = 6.0
offset_bottom = 3.0
color = Color(0.96, 0.68, 0.33, 1)
```

说明：
- `collision_layer = 4`（图层 3 = bullets）
- `collision_mask = 2`（图层 2 = enemies，只检测敌人）
- 子弹是橙色小矩形

- [ ] **Step 4.4: 创建 Starship 场景 scenes/Starship.tscn**

```ini
[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://scripts/MainTurret.cs" id="1"]

[node name="Starship" type="Node2D"]

[node name="Body" type="ColorRect" parent="."]
offset_left = -150.0
offset_top = -50.0
offset_right = 150.0
offset_bottom = 50.0
color = Color(0.29, 0.33, 0.4, 1)

[node name="Engine" type="ColorRect" parent="."]
offset_left = -160.0
offset_top = -20.0
offset_right = -140.0
offset_bottom = 20.0
color = Color(0.96, 0.54, 0.33, 1)

[node name="MainTurret" type="Node2D" parent="."]
position = Vector2(50, 0)
script = ExtResource("1")

[node name="Barrel" type="ColorRect" parent="MainTurret"]
offset_left = 0.0
offset_top = -4.0
offset_right = 40.0
offset_bottom = 4.0
color = Color(0.96, 0.26, 0.26, 1)
```

说明：
- 星舰主体深灰矩形，引擎火焰橙色
- 主炮在 (50, 0) 位置（星舰前部），红色炮管
- 主炮挂 MainTurret 脚本

- [ ] **Step 4.5: 更新 Main.tscn，引用 Starship 场景**

```ini
[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://scripts/CameraPull.cs" id="1"]
[ext_resource type="PackedScene" path="res://scenes/Starship.tscn" id="2"]
[ext_resource type="PackedScene" path="res://scenes/Bullet.tscn" id="3"]

[node name="Main" type="Node2D"]

[node name="Background" type="ParallaxBackground" parent="."]

[node name="ParallaxLayer" type="ParallaxLayer" parent="Background"]

[node name="Stars" type="ColorRect" parent="Background/ParallaxLayer"]
offset_left = -500.0
offset_top = -500.0
offset_right = 2000.0
offset_bottom = 1500.0
color = Color(0.04, 0.04, 0.18, 1)

[node name="Camera2D" type="Camera2D" parent="."]
script = ExtResource("1")

[node name="Starship" parent="." instance=ExtResource("2")]
position = Vector2(200, 360)

[node name="TargetDummy" type="Area2D" parent="."]
position = Vector2(800, 360)
collision_layer = 2
collision_mask = 0

[node name="CollisionShape2D" type="CollisionShape2D" parent="TargetDummy"]
shape = SubResource("RectangleShape2D_dummy")

[node name="DummyBody" type="ColorRect" parent="TargetDummy"]
offset_left = -30.0
offset_top = -30.0
offset_right = 30.0
offset_bottom = 30.0
color = Color(0.96, 0.26, 0.26, 0.5)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_dummy"]
size = Vector2(60, 60)
```

说明：
- 用 `instance=ExtResource("2")` 引用 Starship.tscn
- 在右侧 (800, 360) 放了一个红色占位符敌人，用于测试碰撞
- TargetDummy 需要挂 Enemy 脚本，下一步添加

- [ ] **Step 4.6: 编译验证**

```bash
dotnet build
```

- [ ] **Step 4.7: 提交**

```bash
git add scripts/MainTurret.cs scripts/Bullet.cs scenes/Starship.tscn scenes/Bullet.tscn scenes/Main.tscn
git commit -m "feat: add main turret with mouse-follow and bullet shooting"
```

---

### Task 5: 敌人基类与占位符

**目标:** 敌人有 HP、可被子弹击毁、掉落资源。

**文件:**
- 创建: `scripts/Enemy.cs`
- 修改: `scenes/Main.tscn`（给 TargetDummy 挂脚本）

- [ ] **Step 5.1: 创建 Enemy.cs**

```csharp
using Godot;

/// <summary>
/// 敌人基类。
/// 挂在 Area2D 节点上。管理 HP、移动、死亡和资源掉落。
/// 具体敌人继承此脚本或通过配置覆盖参数。
/// </summary>
[GlobalClass]
public partial class Enemy : Area2D
{
    /// <summary>最大 HP</summary>
    [Export] public float MaxHp = 100f;

    /// <summary>移动速度（像素/秒）</summary>
    [Export] public float MoveSpeed = 80f;

    /// <summary>死亡时掉落的资源数量</summary>
    [Export] public int ResourceReward = 50;

    /// <summary>当前 HP</summary>
    private float _currentHp;

    /// <summary>是否已被标记销毁</summary>
    private bool _isDead = false;

    // ========== Signals ==========

    [Signal]
    public delegate void EnemyDamagedEventHandler(float currentHp, float maxHp);

    [Signal]
    public delegate void EnemyDiedEventHandler(int resourceReward);

    public override void _Ready()
    {
        _currentHp = MaxHp;

        // 被子弹碰撞时触发
        BodyEntered += OnBodyEntered;
        AreaEntered += OnAreaEntered;
    }

    public override void _Process(double delta)
    {
        // 从右向左移动
        Position += Vector2.Left * MoveSpeed * (float)delta;

        // 超出左边界后销毁
        if (Position.X < -100)
        {
            QueueFree();
        }
    }

    /// <summary>
    /// 受到伤害
    /// </summary>
    public void TakeDamage(float amount)
    {
        if (_isDead) return;

        _currentHp -= amount;
        EmitSignal(SignalName.EnemyDamaged, _currentHp, MaxHp);

        GD.Print($"[{Name}] 受到伤害 {amount:F0}，剩余 HP: {_currentHp:F0}/{MaxHp:F0}");

        if (_currentHp <= 0f)
        {
            Die();
        }
    }

    /// <summary>
    /// 敌人死亡
    /// </summary>
    private void Die()
    {
        _isDead = true;
        GD.Print($"[{Name}] 被击毁！掉落资源: {ResourceReward}");

        // 通知 GameManager 增加资源
        var gameManager = GetNode<GameManager>("/root/GameManager");
        gameManager.AddResources(ResourceReward);

        // 发送死亡信号
        EmitSignal(SignalName.EnemyDied, ResourceReward);

        // 销毁
        QueueFree();
    }

    /// <summary>
    /// Area2D 碰撞回调（子弹是 Area2D）
    /// </summary>
    private void OnAreaEntered(Area2D area)
    {
        // Bullet 类通过 BodyEntered 处理，这里处理 Area2D 类型的碰撞
        if (area is Bullet bullet)
        {
            TakeDamage(bullet.Damage);
        }
    }

    /// <summary>
    /// 物理体碰撞回调
    /// </summary>
    private void OnBodyEntered(Node2D body)
    {
        // 如果碰撞的是子弹，已在 Bullet 的 OnBodyEntered 中处理
        // 这里留空，留给后续碰撞逻辑（如撞到星舰）
    }
}
```

关键点：
- 从右向左匀速移动
- `TakeDamage` 可被子弹调用
- 死亡时通过 GameManager 增加玩家资源
- 使用 `AreaEntered` 检测 Area2D 类型子弹碰撞
- `GD.Print` 输出战斗日志用于调试

- [ ] **Step 5.2: 创建 Enemy 场景 scenes/Enemy.tscn**

```ini
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/Enemy.cs" id="1"]

[node name="Enemy" type="Area2D"]
collision_layer = 2
collision_mask = 4
script = ExtResource("1")

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]

[node name="Sprite" type="ColorRect" parent="."]
offset_left = -25.0
offset_top = -25.0
offset_right = 25.0
offset_bottom = 25.0
color = Color(0.96, 0.26, 0.26, 0.7)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_enemy"]
size = Vector2(50, 50)
```

说明：
- `collision_layer = 2`（图层 2 = enemies）
- `collision_mask = 4`（图层 3 = bullets，检测子弹）
- 红色方块占位符

- [ ] **Step 5.3: 编译验证**

```bash
dotnet build
```

- [ ] **Step 5.4: 提交**

```bash
git add scripts/Enemy.cs scenes/Enemy.tscn
git commit -m "feat: add Enemy base class with HP, movement, and resource drop"
```

---

### Task 6: WaveData 资源类与波次配置

**目标:** 用 Resource 定义波次配置，可被 EnemySpawner 读取。

**文件:**
- 创建: `resources/WaveData.cs`

- [ ] **Step 6.1: 创建 WaveData.cs**

```csharp
using Godot;
using System.Collections.Generic;

/// <summary>
/// 单个波次的敌人配置
/// </summary>
[GlobalClass]
public partial class WaveConfig : Resource
{
    /// <summary>波次中的敌人数量</summary>
    [Export] public int EnemyCount = 3;

    /// <summary>敌人出现间隔（秒）</summary>
    [Export] public float SpawnInterval = 1.5f;

    /// <summary>生成位置 Y 坐标范围（相对于中心）</summary>
    [Export] public float SpawnYRange = 200f;
}

/// <summary>
/// 关卡波次数据 Resource。
/// 在 Godot 编辑器中创建 .tres 文件来配置每关的波次。
/// </summary>
[GlobalClass]
public partial class WaveData : Resource
{
    /// <summary>关卡编号</summary>
    [Export] public int LevelNumber = 1;

    /// <summary>波次列表</summary>
    [Export] public Godot.Collections.Array<WaveConfig> Waves = new();

    /// <summary>通关资源奖励</summary>
    [Export] public int LevelReward = 200;

    /// <summary>关卡名称（显示用）</summary>
    [Export] public string LevelName = "第一关";
}
```

- [ ] **Step 6.2: 编译验证**

```bash
dotnet build
```

- [ ] **Step 6.3: 提交**

```bash
git add resources/WaveData.cs
git commit -m "feat: add WaveData and WaveConfig Resource classes for wave configuration"
```

---

### Task 7: 敌人生成器与战斗循环

**目标:** 读取 WaveData，按波次生成敌人，全部消灭后触发胜利。

**文件:**
- 创建: `scripts/EnemySpawner.cs`
- 创建: `scripts/ResourceCounter.cs`
- 创建: `scripts/HUD.cs`
- 创建: `scenes/HUD.tscn`
- 修改: `scenes/Main.tscn`（添加生成器和 HUD）

- [ ] **Step 7.1: 创建 EnemySpawner.cs**

```csharp
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
        _waveData = GD.Load<WaveData>(WaveDataPath);
        _enemyScene = GD.Load<PackedScene>(EnemyScenePath);

        if (_waveData == null)
        {
            GD.PrintErr($"[EnemySpawner] 无法加载波次数据: {WaveDataPath}");
            return;
        }

        if (_enemyScene == null)
        {
            GD.PrintErr($"[EnemySpawner] 无法加载敌人预制体: {EnemyScenePath}");
            return;
        }

        GD.Print($"[EnemySpawner] 加载关卡 {_waveData.LevelName}，共 {_waveData.Waves.Count} 波");

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
```

- [ ] **Step 7.2: 创建 ResourceCounter.cs**

```csharp
using Godot;

/// <summary>
/// 资源计数器。
/// 监听 GameManager 的资源变化事件，更新 HUD 显示。
/// 挂在 HUD 的资源显示节点上。
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
```

- [ ] **Step 7.3: 创建 HUD.cs**

```csharp
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
```

- [ ] **Step 7.4: 创建 HUD 场景 scenes/HUD.tscn**

```ini
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/HUD.cs" id="1"]

[node name="HUD" type="CanvasLayer"]
script = ExtResource("1")

[node name="Control" type="Control" parent="."]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0

[node name="WaveLabel" type="Label" parent="Control"]
offset_left = 10.0
offset_top = 10.0
offset_right = 150.0
offset_bottom = 35.0
theme_override_font_sizes/font_size = 18
text = "波次: 0"

[node name="ResourceLabel" type="Label" parent="Control"]
offset_left = 10.0
offset_top = 40.0
offset_right = 150.0
offset_bottom = 65.0
theme_override_font_sizes/font_size = 18
text = "💎 0"

[node name="ShipHpBar" type="ProgressBar" parent="Control"]
offset_left = 10.0
offset_top = 70.0
offset_right = 210.0
offset_bottom = 85.0
max_value = 1000.0
value = 1000.0
show_percentage = false

[node name="ShipHpLabel" type="Label" parent="Control"]
offset_left = 220.0
offset_top = 70.0
offset_right = 320.0
offset_bottom = 85.0
theme_override_font_sizes/font_size = 14
text = "1000 / 1000"
```

- [ ] **Step 7.5: 更新 Main.tscn 添加 EnemySpawner 和 HUD**

```ini
[gd_scene load_steps=5 format=3]

[ext_resource type="Script" path="res://scripts/CameraPull.cs" id="1"]
[ext_resource type="PackedScene" path="res://scenes/Starship.tscn" id="2"]
[ext_resource type="PackedScene" path="res://scenes/Enemy.tscn" id="3"]
[ext_resource type="PackedScene" path="res://scenes/HUD.tscn" id="4"]

[node name="Main" type="Node2D"]

[node name="Background" type="ParallaxBackground" parent="."]

[node name="ParallaxLayer" type="ParallaxLayer" parent="Background"]

[node name="Stars" type="ColorRect" parent="Background/ParallaxLayer"]
offset_left = -500.0
offset_top = -500.0
offset_right = 2000.0
offset_bottom = 1500.0
color = Color(0.04, 0.04, 0.18, 1)

[node name="Camera2D" type="Camera2D" parent="."]
script = ExtResource("1")

[node name="Starship" parent="." instance=ExtResource("2")]
position = Vector2(200, 360)

[node name="EnemySpawner" type="Node2D" parent="."]
position = Vector2(0, 360)

[node name="HUD" parent="." instance=ExtResource("4")]
```

注意：不再需要 TargetDummy，因为 EnemySpawner 会动态生成敌人。

- [ ] **Step 7.6: 创建 wave_1.tres 配置**

```ini
[gd_resource type="Resource" format=3]

[resource]
script = ExtResource("WaveData_cs")
level_number = 1
level_name = "第一关"
level_reward = 200
waves = [{
"enemy_count": 5,
"spawn_interval": 2.0,
"spawn_y_range": 150.0
}, {
"enemy_count": 8,
"spawn_interval": 1.5,
"spawn_y_range": 200.0
}]
```

由于 .tres 文件引用脚本的方式比较复杂，我们创建一个简化的方式——直接在 EnemySpawner 中硬编码默认波次配置作为 fallback。

修改 EnemySpawner.cs 的 `_Ready` 方法，如果无法加载 WaveData 则使用默认配置：

在 `EnemySpawner` 类中添加默认波次创建逻辑：

```csharp
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
```

将 `_Ready` 中的 `GD.Load<WaveData>` 替换为 `LoadOrCreateWaveData()`。

- [ ] **Step 7.7: 编译验证**

```bash
dotnet build
```

- [ ] **Step 7.8: 提交**

```bash
git add scripts/EnemySpawner.cs scripts/ResourceCounter.cs scripts/HUD.cs scenes/HUD.tscn scenes/Main.tscn resources/
git commit -m "feat: add enemy spawner with wave system, HUD, and resource counter"
```

---

### Task 8: 完整战斗循环集成测试

**目标:** 验证从启动游戏到通关的完整流程。

- [ ] **Step 8.1: 集成验证清单**

需要手动在 Godot 编辑器中测试（需要安装 Godot 4.x）：

1. **项目启动** — Godot 能识别项目，无报错
2. **相机拖动** — 鼠标右键拖动，星舰右方视野扩展，有边界限制
3. **主炮跟随** — 主炮 360 度跟随鼠标
4. **射击** — 左键射击，橙色子弹沿炮管方向飞出
5. **子弹命中** — 子弹命中敌人时，敌人扣血（GD.Print 日志）
6. **敌人移动** — 敌人从右向左匀速移动
7. **敌人死亡** — 敌人 HP=0 时销毁，资源计数增加
8. **波次生成** — 第一波 5 个敌人，间隔 2 秒
9. **波次切换** — 第一波全部消灭后，等待 5 秒，开始第二波 8 个敌人
10. **关卡胜利** — 第二波全部消灭后，HUD 显示胜利状态
11. **HUD 更新** — 波次、资源数实时更新

- [ ] **Step 8.2: 编译最终验证**

```bash
dotnet build && echo "BUILD SUCCESS"
```

- [ ] **Step 8.3: 最终提交**

```bash
git add -A
git commit -m "feat: complete Phase 1-2 playable prototype with camera, turret, enemies, and wave system"
```

---

## 验证方式总结

由于 Godot 编辑器未安装，本阶段的验证方式为：

1. **编译验证**: `dotnet build` 必须零错误通过
2. **代码审查**: 所有 Signal 连接、节点路径、碰撞图层配置正确
3. **手动测试**: 安装 Godot 4.3+ 后打开项目，按 Task 8.1 的清单逐项测试

## 前置依赖安装

在开始实现前，需要安装 Godot 4.x：

```bash
# 方法 1: 下载 Godot 4.x Mono 版本
# https://godotengine.org/download/linux/

# 方法 2: 使用 Flatpak
flatpak install flathub org.godotengine.Godot

# 方法 3: 使用 Snap
sudo snap install godot-4 --classic
```

安装后验证：

```bash
godot --version  # 应输出 4.x.x
```
