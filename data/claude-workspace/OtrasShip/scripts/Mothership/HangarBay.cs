using System.Collections.Generic;
using Godot;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Mothership;

/// <summary>
/// 机库 — 管理最多 4 架战斗机。
/// 挂载在母舰上，负责生成战斗机、跟踪存活数、冷却补充。
/// 战斗机被毁或返航后，经过冷却时间自动补充新战斗机。
/// </summary>
public partial class HangarBay : EntityBase
{
    // ─────────── 配置参数 ───────────

    /// <summary>机库最大战斗机数量</summary>
    [Export] public int MaxFighters { get; set; } = 4;

    /// <summary>战斗机被毁/返航后重新生成的冷却时间（秒）</summary>
    [Export] public float SpawnCooldown { get; set; } = 10f;

    /// <summary>建造消耗资源</summary>
    [Export] public int HangarCost { get; set; } = 300;

    /// <summary>机库血量</summary>
    [Export] public int HangarMaxHealth { get; set; } = 400;

    /// <summary>机库碰撞体半宽</summary>
    [Export] public float SlotHalfWidth { get; set; } = 30f;

    /// <summary>机库碰撞体半高</summary>
    [Export] public float SlotHalfHeight { get; set; } = 20f;

    [Export(PropertyHint.File)]
    public string FighterScenePath { get; set; } = "res://scenes/Fighter.tscn";

    // ─────────── 内部状态 ───────────

    private int _aliveCount;
    private Queue<float> _cooldownTimers = new();
    private bool _isBuilt;
    private PackedScene _fighterScene;
    private Node2D _mothership;

    /// <summary>机库是否已建造</summary>
    public bool IsBuilt => _isBuilt;

    /// <summary>机库插槽索引（由 TurretSlotManager 设置）</summary>
    public int SlotIndex { get; set; }

    // ─────────── 信号 ───────────

    /// <summary>机库被摧毁时发出（携带插槽索引）</summary>
    [Signal] public delegate void HangarDiedEventHandler(int slotIndex);

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        EntityName = "机库";
        _mothership = GetTree().Root.GetNodeOrNull<Node2D>("Main/Mothership");

        // 加载战斗机场景
        _fighterScene = GD.Load<PackedScene>(FighterScenePath);
        if (_fighterScene == null)
        {
            GD.PrintErr("[HangarBay] 无法加载战斗机场景");
        }

        // 未建造时不初始化子节点
        if (!_isBuilt) return;

        InitBuilt();
    }

    public override void _Process(double delta)
    {
        if (!_isBuilt) return;

        float dt = (float)delta;

        // 处理冷却队列
        if (_cooldownTimers.Count > 0)
        {
            float timer = _cooldownTimers.Peek() - dt;
            if (timer <= 0)
            {
                _cooldownTimers.Dequeue();
                SpawnFighter();
            }
            else
            {
                _cooldownTimers.Dequeue();
                _cooldownTimers.Enqueue(timer);
            }
        }
    }

    // ─────────── 公共方法 ───────────

    /// <summary>
    /// 建造机库 — 扣除资源并初始化。
    /// 由 TurretSlotManager 调用。
    /// </summary>
    public void Build()
    {
        if (_isBuilt) return;

        _isBuilt = true;
        InitBuilt();

        // 初始生成所有战斗机（分批次，间隔 0.5s）
        for (int i = 0; i < MaxFighters; i++)
        {
            CallDeferred(MethodName.SpawnFighter);
        }
    }

    /// <summary>
    /// 战斗机被摧毁（非正常返航）— 启动冷却计时。
    /// 由 Fighter.OnDied() 调用。
    /// </summary>
    public void OnFighterDestroyed()
    {
        if (!_isBuilt) return;
        _aliveCount = Mathf.Max(0, _aliveCount - 1);

        // 启动冷却计时
        _cooldownTimers.Enqueue(SpawnCooldown);

        GD.Print($"[HangarBay] 战斗机被毁，存活={_aliveCount}，冷却={SpawnCooldown}s");
    }

    /// <summary>
    /// 战斗机返航到达母舰 — 消失回库，启动冷却计时。
    /// 由 Fighter.OnArrivedAtMothership() 调用。
    /// </summary>
    public void OnFighterReturned()
    {
        if (!_isBuilt) return;
        _aliveCount = Mathf.Max(0, _aliveCount - 1);

        // 返航后也进入冷却（满血重新出发）
        _cooldownTimers.Enqueue(SpawnCooldown);

        GD.Print($"[HangarBay] 战斗机返航，存活={_aliveCount}，冷却={SpawnCooldown}s");
    }

    /// <summary>
    /// 召回所有战斗机（波次结束时使用）。
    /// 遍历所有存活的 player_fighter，强制切 Return 状态。
    /// </summary>
    public void RecallAll()
    {
        if (!_isBuilt) return;

        var fighters = GetTree().GetNodesInGroup("player_fighter");
        foreach (var node in fighters)
        {
            if (node is Fighter.Fighter fighter)
            {
                if (fighter.OwnerHangar == this)
                {
                    var ai = fighter.GetNodeOrNull<AI.FighterAI>("FighterAI");
                    ai?.ForceReturn();
                }
            }
        }

        GD.Print("[HangarBay] 召回所有战斗机");
    }

    // ─────────── 私有方法 ───────────

    /// <summary>
    /// 初始化已建造状态（创建 HealthComponent、精灵等）。
    /// </summary>
    private void InitBuilt()
    {
        // 动态创建 HealthComponent（Dummy 占位）
        var dummy = new Node();
        dummy.Name = "FirstSlotDummy";
        AddChild(dummy);

        var health = new HealthComponent();
        health.Name = "HealthComponent";
        health.MaxHealth = HangarMaxHealth;
        AddChild(health);
        MoveChild(dummy, 0);

        // 调用 base._Ready()（挂钩 Died 信号）
        base._Ready();

        // 动态创建碰撞体
        var collisionShape = new CollisionShape2D();
        collisionShape.Name = "CollisionShape";
        var rect = new RectangleShape2D();
        rect.Size = new Vector2(SlotHalfWidth * 2, SlotHalfHeight * 2);
        collisionShape.Shape = rect;
        AddChild(collisionShape);
        MoveChild(collisionShape, 0);

        // 动态创建精灵（蓝色矩形占位）
        var sprite = new Sprite2D();
        sprite.Name = "Sprite";
        PlaceholderArt.ApplyRect(sprite, (int)(SlotHalfWidth * 2), (int)(SlotHalfHeight * 2), new Color(0.2f, 0.4f, 0.8f));
        AddChild(sprite);
        MoveChild(sprite, 0);

        // 加入机库组
        AddToGroup("hangar");

        GD.Print($"[HangarBay] 建造完成，血量={health.CurrentHealth}/{health.MaxHealth}，最大战斗机={MaxFighters}");
    }

    /// <summary>
    /// 生成一架战斗机并添加到 Main 场景（世界坐标）。
    /// </summary>
    private void SpawnFighter()
    {
        if (_fighterScene == null || _mothership == null) return;
        if (_aliveCount >= MaxFighters) return;

        var fighter = _fighterScene.Instantiate<Fighter.Fighter>();

        // 设置机库出口位置（世界坐标）
        Vector2 spawnOffset = new Vector2(0, (_aliveCount % 2 == 0 ? -15f : 15f));
        fighter.GlobalPosition = GlobalPosition + spawnOffset;

        // 设置所属机库引用
        fighter.OwnerHangar = this;

        // 添加到 Main 场景（世界坐标，不是母舰子节点）
        var main = GetTree().Root.GetNode("Main");
        main.AddChild(fighter);

        _aliveCount++;
        GD.Print($"[HangarBay] 生成战斗机 #{_aliveCount}");
    }

    protected override void OnDied()
    {
        GD.Print("[HangarBay] 被摧毁");
        _isBuilt = false;
        _cooldownTimers.Clear();

        // 召回所有战斗机
        RecallAll();

        EmitSignal(SignalName.HangarDied, SlotIndex);
        base.OnDied();
    }
}
