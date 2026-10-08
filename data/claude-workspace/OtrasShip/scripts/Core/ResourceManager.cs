using Godot;

namespace OtrasShip.Core;

/// <summary>
/// 资源管理器（Autoload 单例）— 管理游戏内资源的获取和消耗。
/// 击杀敌人时直接加资源（无物理掉落），建造/升级时扣除。
/// 关卡结束时未使用的资源保留，可用于永久升级。
/// </summary>
public partial class ResourceManager : Node
{
    // ─────────── 单例访问 ───────────

    public static ResourceManager Instance { get; private set; }

    // ─────────── 配置参数 ───────────

    [Export] public int StartingResources { get; set; } = 3000;

    // ─────────── 信号 ───────────

    /// <summary>资源数量变化时发出</summary>
    [Signal] public delegate void ResourceChangedEventHandler(int current);

    // ─────────── 状态 ───────────

    private int _currentResources = 0;
    private int _totalEarned = 0;
    private int _totalSpent = 0;

    /// <summary>当前资源数</summary>
    public int CurrentResources => _currentResources;

    /// <summary>累计获取资源</summary>
    public int TotalEarned => _totalEarned;

    /// <summary>累计消耗资源</summary>
    public int TotalSpent => _totalSpent;

    // ─────────── 生命周期 ───────────

    public override void _Ready()
    {
        // 场景重载时，静态 Instance 仍指向已销毁的旧实例。
        // 检测并销毁旧实例，确保全局只有一个 ResourceManager。
        if (Instance != null && Instance != this)
        {
            Instance.QueueFree();
        }
        Instance = this;
        _currentResources = StartingResources;
    }

    public override void _ExitTree()
    {
        // 清除静态引用，防止销毁后其他代码通过 Instance 访问无效对象
        if (Instance == this) Instance = null;
    }

    // ─────────── 公共方法 ───────────

    /// <summary>
    /// 增加资源（击杀敌人等来源）
    /// </summary>
    public void AddResource(int amount)
    {
        if (amount <= 0) return;

        _currentResources += amount;
        _totalEarned += amount;
        EmitSignal(SignalName.ResourceChanged, _currentResources);
    }

    /// <summary>
    /// 检查当前资源是否足够购买指定物品（不扣除资源）
    /// </summary>
    /// <param name="cost">购买所需资源</param>
    /// <returns>true 如果资源足够，否则 false</returns>
    public bool CanAfford(int cost)
    {
        return _currentResources >= cost;
    }

    /// <summary>
    /// 尝试扣除资源，不足时返回 false
    /// </summary>
    public bool TrySpend(int amount)
    {
        if (amount <= 0) return true;
        if (_currentResources < amount)
            return false;

        _currentResources -= amount;
        _totalSpent += amount;
        EmitSignal(SignalName.ResourceChanged, _currentResources);
        return true;
    }

    /// <summary>
    /// 强制扣除资源（可为负数，用于调试或特殊场景）
    /// </summary>
    public void ForceSpend(int amount)
    {
        _currentResources -= amount;
        if (amount > 0) _totalSpent += amount;
        EmitSignal(SignalName.ResourceChanged, _currentResources);
    }
}
