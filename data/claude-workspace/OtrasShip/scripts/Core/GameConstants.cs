using Godot;

namespace OtrasShip.Core;

/// <summary>
/// 全局常量 — 集中定义多处复用的数值常量。
/// 当需要修改时只改这里一处，避免散落在多个文件中导致遗漏。
/// </summary>
public static class GameConstants
{
    // ─────────── 母舰碰撞体尺寸 ───────────

    /// <summary>母舰碰撞体半宽（960 的一半）</summary>
    public const float MothershipHalfWidth = 480f;

    /// <summary>母舰碰撞体半高（480 的一半）</summary>
    public const float MothershipHalfHeight = 240f;

    /// <summary>母舰碰撞体半尺寸向量（用于矩形边界计算）</summary>
    public static readonly Vector2 MothershipHalfSize = new(MothershipHalfWidth, MothershipHalfHeight);

    /// <summary>炮塔碰撞层（layer 8），位值 256</summary>
    public const uint TurretCollisionLayer = 256;

    /// <summary>友方战斗机碰撞层（layer 9），位值 256</summary>
    public const uint PlayerFighterCollisionLayer = 256;
}
