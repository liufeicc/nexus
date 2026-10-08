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
