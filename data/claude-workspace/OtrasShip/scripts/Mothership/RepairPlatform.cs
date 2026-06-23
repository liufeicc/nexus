using Godot;
using System.Collections.Generic;
using OtrasShip.Core;
using OtrasShip.Entity;

namespace OtrasShip.Mothership;

/// <summary>
/// 维修平台管理器
/// 负责：
/// - 跟踪已购买的机器人数量（0-6）
/// - 按间隔（0.5秒）放出机器人
/// - 提供机器人生成点位置
/// - 处理购买逻辑（扣除资源、生成实例）
/// </summary>
public partial class RepairPlatform : Node2D
{
    #region Export 参数

    /// <summary>最大机器人数</summary>
    [Export] public int MaxBots { get; set; } = 6;

    /// <summary>放出间隔（秒）</summary>
    [Export] public float BotSpawnInterval { get; set; } = 0.5f;

    /// <summary>购买成本</summary>
    [Export] public int BotCost { get; set; } = 150;

    /// <summary>生成位置标记点</summary>
    [Export] public Marker2D SpawnPoint { get; set; }

    #endregion

    #region 私有字段

    private int _purchasedCount = 0;
    private List<RepairBot> _activeBots = new();
    private float _spawnTimer = 0f;
    private Queue<RepairBot> _pendingRelease = new();
    private Area2D _clickArea;

    #endregion

    #region 公开属性

    /// <summary>已购买的机器人数量</summary>
    public int PurchasedCount => _purchasedCount;

    /// <summary>是否还能购买更多机器人</summary>
    public bool CanBuyMore => _purchasedCount < MaxBots;

    #endregion

    #region 生命周期

    public override void _Ready()
    {
        GD.Print($"[RepairPlatform] 初始化完成，最大机器人数: {MaxBots}，成本: {BotCost}");

        // 创建点击区域（100x100 像素），点击后购买机器人
        _clickArea = new Area2D();
        _clickArea.Name = "ClickArea";
        _clickArea.InputPickable = true;
        _clickArea.CollisionLayer = 0;
        _clickArea.CollisionMask = 0;
        AddChild(_clickArea);

        var collision = new CollisionShape2D();
        collision.Name = "CollisionShape2D";
        var shape = new RectangleShape2D();
        shape.Size = new Vector2(100, 100);
        collision.Shape = shape;
        _clickArea.AddChild(collision);

        _clickArea.InputEvent += OnClickAreaInput;
    }

    /// <summary>
    /// 点击区域输入处理：鼠标左键点击时购买机器人
    /// </summary>
    private void OnClickAreaInput(Node viewport, InputEvent @event, long shapeIdx)
    {
        if (@event is InputEventMouseButton mouseButton
            && mouseButton.ButtonIndex == MouseButton.Left
            && mouseButton.Pressed)
        {
            GD.Print("[RepairPlatform] 点击购买机器人");
            bool success = BuyBot();
            if (success)
            {
                GD.Print("[RepairPlatform] 购买成功！");
            }
            else
            {
                GD.PrintErr("[RepairPlatform] 购买失败（资源不足或已达上限）");
            }
        }
    }

    public override void _Process(double delta)
    {
        // 处理待放出的机器人队列
        if (_pendingRelease.Count > 0)
        {
            _spawnTimer += (float)delta;
            if (_spawnTimer >= BotSpawnInterval)
            {
                _spawnTimer = 0f;
                var bot = _pendingRelease.Dequeue();
                if (IsInstanceValid(bot))
                {
                    bot.Activate();
                    GD.Print($"[RepairPlatform] 放出机器人，剩余队列: {_pendingRelease.Count}");
                }
            }
        }
    }

    #endregion

    #region 公开方法

    /// <summary>
    /// 购买机器人
    /// </summary>
    /// <returns>true 如果购买成功，false 如果资源不足或已达上限</returns>
    public bool BuyBot()
    {
        // 检查上限
        if (_purchasedCount >= MaxBots)
        {
            GD.PrintErr("[RepairPlatform] 已达最大机器人数");
            return false;
        }

        // 检查资源
        var resourceManager = ResourceManager.Instance;
        if (resourceManager == null || !resourceManager.CanAfford(BotCost))
        {
            GD.PrintErr($"[RepairPlatform] 资源不足，需要 {BotCost}");
            return false;
        }

        // 扣除资源
        if (!resourceManager.TrySpend(BotCost))
        {
            return false;
        }

        _purchasedCount++;

        // 生成机器人实例
        var bot = SpawnBot();
        if (bot != null)
        {
            _activeBots.Add(bot);
            GD.Print($"[RepairPlatform] 购买成功，已购买: {_purchasedCount}/{MaxBots}");
            return true;
        }

        return false;
    }

    /// <summary>
    /// 请求放出机器人（将所有 IDLE 状态的机器人加入待放出队列）
    /// </summary>
    public void RequestBotRelease()
    {
        foreach (var bot in _activeBots)
        {
            if (IsInstanceValid(bot) && bot.State == AI.RepairBotAI.BotState.IDLE)
            {
                _pendingRelease.Enqueue(bot);
            }
        }

        GD.Print($"[RepairPlatform] 请求放出，队列大小: {_pendingRelease.Count}");
    }

    #endregion

    #region 私有方法

    /// <summary>
    /// 生成机器人实例
    /// </summary>
    private RepairBot SpawnBot()
    {
        // RepairBot 是完全由代码创建的（不需要 .tscn）
        var bot = new RepairBot();
        bot.Initialize(SpawnPoint);

        if (SpawnPoint != null)
        {
            bot.GlobalPosition = SpawnPoint.GlobalPosition;
        }

        // 添加到场景树
        GetTree().CurrentScene.AddChild(bot);

        GD.Print($"[RepairPlatform] 生成机器人，位置: {bot.GlobalPosition}");
        return bot;
    }

    #endregion
}
