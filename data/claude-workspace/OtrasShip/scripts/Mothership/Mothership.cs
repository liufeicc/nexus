using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Mothership;

/// <summary>
/// 母舰 — 固定在屏幕中央，不可移动。
/// 挂载主炮，提供血量管理。
///
/// 注意：Godot 4 .tscn 存在 Area2D 根节点第一个子节点被静默丢弃的 bug，
/// 因此 CollisionShape2D 和 Body Sprite2D 都在 _Ready() 中动态创建。
/// </summary>
public partial class Mothership : EntityBase
{
    // ─────────── 配置参数 ───────────

    [Export] public int MaxHp { get; set; } = 500;
    [Export] public int ArmorValue { get; set; } = 5;

    /// <summary>船体碰撞体半宽（像素）</summary>
    [Export] public float HullHalfWidth { get; set; } = 480f;

    /// <summary>船体碰撞体半高（像素）</summary>
    [Export] public float HullHalfHeight { get; set; } = 240f;

    // ─────────── 组件引用 ───────────

    private MainCannon _mainCannon;

    /// <summary>维修平台</summary>
    public RepairPlatform RepairPlatform { get; private set; }

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        // ─── 0. 动态创建 HealthComponent ───
        // .tscn 中的 HealthComponent 是 Area2D 根节点的第一个子节点，
        // 被 Godot 4 的 Area2D 首子节点静默丢弃 bug 吞掉。
        // 必须在代码中创建真实的 HealthComponent，并用 Dummy 占位保护。
        var dummyNode = new Node();
        dummyNode.Name = "FirstSlotDummy";
        AddChild(dummyNode);

        var healthComponent = new HealthComponent();
        healthComponent.Name = "HealthComponent";
        healthComponent.MaxHealth = MaxHp;
        healthComponent.Armor = ArmorValue;
        AddChild(healthComponent);

        // 将 Dummy 移到第一个子节点位置，让它承担被丢弃的风险
        MoveChild(dummyNode, 0);

        // ─── 1. 动态创建碰撞形状（规避 Godot .tscn Area2D 首节点丢失 bug）───
        var collisionShape = new CollisionShape2D();
        collisionShape.Name = "CollisionShape";
        var rectShape = new RectangleShape2D();
        rectShape.Size = new Vector2(HullHalfWidth * 2, HullHalfHeight * 2);
        collisionShape.Shape = rectShape;
        AddChild(collisionShape);
        MoveChild(collisionShape, 0); // 移到最前面

        // ── 2. 调用 base._Ready()（EntityBase 查找 HealthComponent 并挂钩 Died 信号）───
        base._Ready();

        EntityName = "母舰";

        // ─── 3. 加入母舰组，供敌方战舰炮塔目标选择使用 ───
        AddToGroup("mothership");

        // ─── 4. 动态创建母舰船体精灵（同样规避首节点丢失 bug）───
        var bodySprite = new Sprite2D();
        bodySprite.Name = "Body";
        bodySprite.Texture = GD.Load<Texture2D>("res://assets/sprites/mothership_hull.png");
        AddChild(bodySprite);
        MoveChild(bodySprite, 0); // 移到最底层（最先渲染）

        // ── 5. 获取主炮 ───
        _mainCannon = GetNodeOrNull<MainCannon>("MainCannon");

        // ─── 6. 动态创建维修平台（避免 .tscn bug）───
        RepairPlatform = new RepairPlatform();
        RepairPlatform.Name = "RepairPlatform";
        AddChild(RepairPlatform);

        // 创建生成点（母舰中部偏下）
        var spawnPoint = new Marker2D();
        spawnPoint.Name = "SpawnPoint";
        spawnPoint.Position = new Vector2(0, 50); // Y 轴向下为正，母舰中部偏下
        RepairPlatform.AddChild(spawnPoint);
        RepairPlatform.SpawnPoint = spawnPoint;

        // ─── 7. HealthComponent 已在步骤 0 创建并配置（MaxHp + ArmorValue）───
        GD.Print($"[母舰] 初始化完成，血量={Health?.CurrentHealth}/{Health?.MaxHealth}，护甲={Health?.Armor}");
    }

    // ─────────── 事件处理 ───────────

    protected override void OnDied()
    {
        GD.Print("[母舰] 被摧毁 — 游戏结束");
        GameManager.Instance?.OnGameOver();
        base.OnDied();
    }
}
