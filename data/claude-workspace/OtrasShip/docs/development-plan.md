# 奥特拉斯星舰 — 开发计划

> 日期: 2026-05-02
> 依赖: `docs/superpowers/specs/2026-05-02-otras-starship-design.md`

## 总体策略

分 8 个阶段开发，每阶段产出可运行、可验证的增量成果。

```
Phase 1-2: 核心玩法可玩原型 (25%)
Phase 3-4: 完整战斗系统 (30%)
Phase 5-6: 关卡循环与元游戏 (20%)
Phase 7-8: 打磨与发布准备 (25%)
```

---

## Phase 1: 项目骨架与可动星舰

**目标**: Godot C# 项目跑起来，星舰在左，相机可拉动，主炮跟随鼠标射击。

**任务**:
1. 创建 Godot 4.x C# 项目 (`project.godot`, `.csproj`)
2. 搭建场景: `Main.tscn`(主场景) + `Starship.tscn`(星舰子场景) + `GameManager`(AutoLoad)
3. `CameraPull.cs` — 鼠标拖动 Camera2D，限制偏移范围
4. `MainTurret.cs` — `GetLocalMousePosition()` 计算角度，`look_at` 跟随
5. `Bullet.cs` — Area2D 直线弹体，出界 `queue_free()`
6. 单击射击，命中占位符敌人扣 HP

**验证**: 拖拽相机有边界、主炮跟随、子弹命中扣血打印日志。

---

## Phase 2: 敌人波次与基础战斗循环

**目标**: 敌人按波次从右侧出现，击毁获资源，全部清除后胜利。

**任务**:
1. `Enemy.cs` 基类 — HP、右向左移动、`enemy_destroyed` Signal
2. 2-3 种敌人变体（不同 HP、速度）
3. `WaveData.tres` Resource — 关卡编号、波次配置、Boss 占位
4. `EnemySpawner.cs` — 读取 WaveData，按计时器实例化敌人
5. 子弹碰撞扣 HP，HP=0 销毁
6. `ResourceCounter.cs` — 累加敌人掉落资源
7. 基础 HUD — 星舰 HP、波次、资源
8. 关卡胜利条件

**验证**: 敌人按波次出现，击毁可见扣血，全部清除触发胜利。

---

## Phase 3: 小炮槽位与三种武器

**目标**: 12 个槽位装备三种武器，各自独立开火。

**任务**:
1. `WeaponData.cs` 基类 Resource — damage, fire_rate, range, projectile_speed
2. 三个子类: `CannonData`, `MissileData`, `LaserData`
3. `TurretSlot.cs` — 加载 WeaponData，维护 `fire_timer`，射程内找最近敌人
4. Cannon: 直线弹体（复用 Bullet）
5. Missile: 追踪最近敌人 2 秒，命中 AOE 伤害
6. Laser: RayCast2D 持续伤害，Line2D 激光线
7. 星舰上放置 12 个槽位（每种 4 个）

**验证**: 三种武器弹道效果不同，数值可从 Resource 文件调参。

**⚠️ 风险**: 导弹追踪振荡 — 用角度插值+最大转向速率；Laser 每帧检测性能 — 加检测间隔。

---

## Phase 4: 停机坪、战斗机 AI 与修理平台

**目标**: 停机坪释放战斗机自主攻击，修理平台自动调度机器人。

**任务**:
1. `Fighter.cs` — AI 状态机: Patrol → Chase → Attack → Return
2. `HangarBay.cs` — `max_fighters=4`，按序释放和回收
3. 4 个停机坪，关卡开始自动释放全部战斗机
4. `RepairRobot.cs` — 飞向目标模块，回复 HP
5. `RepairBay.cs` — 找最低 HP 目标，分配机器人，最多 12 个
6. RepairBay 和 HangarBay 标记不可被摧毁

**验证**: 战斗机自主攻击，被击毁可见减少；修理机器人自动飞向受损模块回复 HP。

**⚠️ 风险**: Fighter AI 碰撞重叠 — 用 CharacterBody2D + 间距保持；修理机器人竞争条件 — "认领"机制。

---

## Phase 5: Boss 战与多关卡系统

**目标**: Boss 敌人、多关卡切换、完整关卡流程。

**任务**:
1. `Boss.cs` — 大幅 HP、多阶段攻击（弹幕/召唤/冲撞）
2. 扩展 WaveData — 支持 boss 字段
3. 关卡过渡: 胜利 → 延迟 → 下一关；HP=0 → Game Over → 重试
4. 3 个关卡配置（难度递增）

**验证**: Boss 多阶段行为正确，可连续通关 3 关。

---

## Phase 6: 升级商店与持久化

**目标**: 关卡间升级商店，数据持久化。

**任务**:
1. `SaveData.cs` — 武器等级、停机坪数量、修理速率、星舰 HP、资源
2. `SaveManager.cs` — ConfigFile/JSON 读写
3. `UpgradeShop.tscn` — UI 升级界面
4. 购买逻辑 — 扣资源、更新数据、应用效果
5. 流程: 胜利 → 结算 → 商店 → 下一关
6. 升级效果: Resource 基础值 × 升级乘数 = 最终值

**验证**: 升级数据保存到磁盘，重启后保留，升级效果正确生效。

---

## Phase 7: 美术替换与视觉打磨

**目标**: 写实科幻风美术替换占位符，添加特效。

**任务**:
1. 星舰、敌人、战斗机、修理机器人 Sprite
2. 爆炸、激光、导弹尾焰、引擎火焰粒子效果 (GPUParticles2D)
3. 多层视差滚动星空背景
4. 小行星、空间站废墟等环境障碍物
5. 科幻风格 HUD

**验证**: 视觉风格统一，粒子效果流畅，无明显性能下降。

---

## Phase 8: 音效、平衡与发布

**目标**: 音效、数值平衡、最终测试、导出发布。

**任务**:
1. 音效: 射击、爆炸、激光、导弹、UI、背景音乐
2. 数值平衡: 武器、敌人、Boss、升级费用曲线
3. 全关卡通关测试、性能测试（目标 60 FPS）
4. 导出配置、README

**验证**: 音效正确播放，3 关难度合理，稳定 60 FPS，导出版本可独立运行。

---

## 依赖关系

```
Phase 1 (项目骨架)
    ↓
Phase 2 (敌人波次)
    ↓
Phase 3 (小炮武器) ──────┐
    ↓                     │
Phase 4 (停机坪+修理)     │
    ↓                     │
Phase 5 (Boss+多关卡) ────┤
                          │
Phase 6 (升级商店) ◄──────┘ (需要 Phase 3 的武器数据)
    ↓
Phase 7 (美术+特效)
    ↓
Phase 8 (音效+平衡+发布)
```

关键路径: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

---

## 技术风险汇总

| 风险 | 严重度 | 阶段 | 缓解策略 |
|------|--------|------|----------|
| Missile 追踪振荡 | 高 | 3 | 角度差值+最大转向速率 |
| Laser 每帧检测性能 | 高 | 3 | 加检测间隔，或 Area2D 重叠检测代替 RayCast2D |
| Fighter AI 碰撞/重叠 | 高 | 4 | CharacterBody2D + 间距保持 |
| 修理机器人竞争条件 | 高 | 4 | "认领"机制，避免多机器人抢同一目标 |
| 大量实体同屏性能 | 高 | 4-5 | 对象池复用子弹和特效 |
| 相机坐标转换 | 中 | 1 | 用 `Camera2D.GetGlobalMousePosition()` |
| 升级数据绑定 | 中 | 6 | Resource 基础值 × 升级乘数 = 最终值 |
| 场景切换状态残留 | 中 | 5 | 明确 queue_free 清理 |
