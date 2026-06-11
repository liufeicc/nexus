# 阶段7：战斗机与机库系统 — 设计规格

**日期**：2026-06-11
**基于文档**：整体设计.md、开发计划.md

---

## 1. 概述

实现母舰的友方战斗机与机库系统。机库生成战斗机，战斗机自动追击敌人，被毁后自动补充。

---

## 2. 需求确认

| 决策项 | 结论 |
|--------|------|
| 战斗机武器 | 固定直线子弹 |
| 碰撞层 | 新增 player_fighter，可被敌方子弹命中 |
| 目标选择 | 与炮塔相同，自动选最近目标（无集火） |
| 建造方式 | 花费 300 资源建造，类似炮塔交互 |
| 机库位置 | 母舰后部 4 个 |
| 维修机制 | 返航后消失回库，满血，冷却后重新出发 |
| 实现方案 | 方案A：最小复用，不强行抽象 |

---

## 3. 新增文件清单

| 文件 | 职责 |
|------|------|
| `scenes/Fighter.tscn` | 友方战斗机场景 |
| `scripts/Fighter/Fighter.cs` | 友方战斗机实体（继承 EntityBase） |
| `scripts/AI/FighterAI.cs` | 友方战斗机 AI 状态机 |
| `scripts/Mothership/HangarBay.cs` | 机库管理逻辑（生成、补充、冷却） |

---

## 4. 碰撞层变更

### 新增层

| 层 | 名称 | 位值 |
|----|------|------|
| 9 | player_fighter | 256 |

### 友方战斗机碰撞配置

- `collision_layer` = 256（player_fighter）
- `collision_mask` = 16（enemy_ammo）— 只被敌方子弹命中

### 敌方子弹更新

- `enemy_ammo`（层5）的 `collision_mask`：`1 | 256 = 257`
- 使敌方子弹能命中友方战斗机

### 碰撞矩阵更新

```
                 母舰  玩家子弹  敌战机  敌战舰  敌弹药  空雷  陨石  炮塔  友方战机
友方战斗机        -      -       -       -      命中    -     -     -      -
敌方弹药         命中     -       -       -       -     -     -     -     命中  ← 新增
```

---

## 5. 友方战斗机

### Fighter.cs（继承 EntityBase）

**场景结构：**
```
Fighter (Area2D)
├── collision_layer = 256 (player_fighter)
├── collision_mask = 16 (enemy_ammo)
├── 动态创建: Dummy + HealthComponent + CollisionShape2D + Sprite2D
│   └── 绿色三角形占位图
├── FlightMovement（Node）
│   └── MaxSpeed=400, Acceleration=300, TurnSpeed=6.0, Drag=2.0
├── FighterAI（Node）
│   └── AttackRange=500, ReturnHealthRatio=0.3
└── HealthBar
```

**Export 参数：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MaxHealth` | 100 | 战斗机最大血量 |
| `FireRate` | 0.3s | 射击间隔 |
| `BulletDamage` | 15 | 子弹伤害 |
| `BulletSpeed` | 800 | 子弹速度 |
| `AttackRange` | 500 | 攻击距离 |
| `ReturnHealthRatio` | 0.3 | 血量低于此比例时返航 |

**关键逻辑：**
- `_Ready()`：加入 `"player_fighter"` 组，动态创建子节点（Dummy 占位模式）
- 射击：固定直线子弹，复用 Bullet.tscn
- `_OnDied()`：通知所属机库 `OnFighterDestroyed()`，不加资源

### FighterAI.cs（状态机）

```csharp
public enum State { Patrol, Combat, Return, Cooldown }
```

**状态流转：**
```
Patrol → 发现敌人 → Combat
Combat → 血量 ≤ 30% → Return
Combat → 无敌人 → Patrol
Return → 到达母舰 → Cooldown
Cooldown → 消失回库，机库计时后重新生成满血战斗机
```

**各状态行为：**

| 状态 | 行为 |
|------|------|
| **Patrol** | 在母舰周围巡逻（绕母舰飞行），每帧搜索最近敌人，发现则切 Combat |
| **Combat** | 用 FlightMovement 追踪目标，保持 AttackRange 距离，持续射击。每帧检查：血量低→Return，无敌人→Patrol |
| **Return** | FlightMovement 目标设为母舰位置，到达后触发消失 |
| **Cooldown** | 已从场景移除，机库内部计时（冷却 10s），时间到后重新生成满血 Fighter |

**目标选择（Patrol/Combat 中共用）：**
- 遍历 `"enemy_fighter"` + `"enemy_battleship"` 组
- 用 `CollisionShapeHelper.GetShapeDistanceTo()` 取最近敌人
- 与炮塔目标选择逻辑模式一致

---

## 6. 机库系统

### HangarBay.cs

挂载在母舰上，每个机库管理最多 4 架战斗机。

**Export 参数：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MaxFighters` | 4 | 机库最大战斗机数量 |
| `SpawnCooldown` | 10.0s | 战斗机被毁后重新生成的冷却时间 |
| `FighterScene` | PackedScene | 战斗机场景引用 |
| `HangarCost` | 300 | 建造消耗资源 |
| `HangarHealth` | 400 | 机库血量 |

**内部状态：**

```csharp
private int _aliveCount;              // 当前存活战斗机数
private Queue<float> _cooldownTimers; // 每架被毁战斗机的冷却计时
private bool _isBuilt;                // 机库是否已建造
```

**核心方法：**

| 方法 | 逻辑 |
|------|------|
| `Build()` | 扣除资源 → 设置 `_isBuilt=true` → 创建 HealthComponent → 初始生成 MaxFighters 架战斗机 |
| `SpawnFighter()` | 实例化 Fighter 场景 → 设置位置（机库出口偏移）→ 加入场景树 → `_aliveCount++` |
| `OnFighterDestroyed()` | `_aliveCount--` → 启动冷却计时器（入队 SpawnCooldown） |
| `_Process()` | 遍历冷却队列，到期的出队 → `SpawnFighter()` |
| `RecallAll()` | 所有存活战斗机强制切 Return 状态（波次结束时用） |
| `OnDied()` | 机库被毁 → 召回所有战斗机 → 停止生成 → 加入组 `"hangar_destroyed"` |

### 机库位置

母舰后部 4 个，作为母舰子节点，通过局部坐标偏移配置：

```
母舰后部示意（左侧为船头，右侧为船尾）：

         [机库1]  [机库2]
         [机库3]  [机库4]
```

### 建造交互

复用炮塔建造模式，扩展 `TurretSlotManager` 支持机库插槽：
- 点击空机库插槽 → 弹出菜单 → 扣 300 资源 → 调用 `Build()`
- `TurretSlotManager` 新增 `hangarSlots` 列表，统一管理炮塔和机库的建造 UI

---

## 7. 战斗机子弹

直接复用现有 `Bullet` 类，不新建文件。

**复用方式：**
- `Fighter` 射击时实例化 `Bullet.tscn`
- 设置子弹参数：伤害 15，弹速 800，方向为战斗机朝向
- 子弹的 collision_layer = 2（player_bullet），collision_mask 不变

---

## 8. 调试与测试

### Main.cs 调试快捷键

| 按键 | 功能 |
|------|------|
| `9` | 在母舰后部安装一个机库（花费 0 资源，直接建造） |
| `0` | 强制所有机库召回战斗机 |

### 验收测试清单

| 测试项 | 预期结果 |
|--------|----------|
| 机库建造 | 点击空插槽 → 扣 300 资源 → 机库生成 4 架战斗机 |
| 战斗机巡逻 | 无敌时战斗机绕母舰飞行 |
| 战斗机追击 | 出现敌人后战斗机自动飞向最近敌人并射击 |
| 战斗机返航 | 血量 ≤30% 时战斗机返航，到达母舰后消失 |
| 自动补充 | 战斗机消失 10s 后机库重新生成满血战斗机 |
| 战斗机受伤 | 敌方子弹能命中友方战斗机，血量下降 |
| 战斗机死亡 | 血量归零后消失，机库开始冷却计时 |
| 机库被毁 | 机库血量归零后停止生成，存活战斗机返航 |
| 调试快捷键 | 按 9 生成机库，按 0 召回战斗机 |

---

## 9. 修改的现有文件清单

| 文件 | 变更 |
|------|------|
| `project.godot` | 新增层 9（player_fighter），更新 enemy_ammo mask |
| `scripts/Core/Main.cs` | 新增调试快捷键 9、0 |
| `scripts/Weapon/EnemyBullet.cs` | 检查碰撞 mask，确认能命中 player_fighter |

---

## 10. 信号交互

```
战斗机被击杀 → 所属 HangarBay.OnFighterDestroyed() → 启动冷却计时
冷却到期 → HangarBay.SpawnFighter() → 新战斗机加入场景

战斗机发现敌人 → FighterAI 切 Combat → 追踪并射击
战斗机血量低 → FighterAI 切 Return → 飞向母舰
到达母舰 → 战斗机消失 → HangarBay.OnFighterDestroyed()

机库被毁 → 遍历存活战斗机 → 强制 Return → 停止生成
```
