# 奥特拉斯星舰 — 游戏设计文档

> 日期: 2026-05-02
> 状态: 已确认

## Context

开发一款横版太空射击游戏"奥特拉斯星舰"，玩家操控一艘大型星舰抵御从右侧来袭的敌人。核心玩法是炮台配置、资源管理和关卡升级。

## 技术栈

- **引擎**: Godot 4.x + C#
- **UI**: Godot Control 节点
- **数据存储**: Resource 文件 (.tres) + ConfigFile (存档)

## 核心玩法

1. 星舰固定在屏幕左侧，鼠标可向右拉动视角扩展视野
2. 主炮跟随鼠标 360 度旋转，单击射击
3. 敌人从右侧出现，按关卡配置波次进攻
4. 消灭敌人获得资源，关卡间在升级商店购买/升级模块

## 整体架构

```
Game.tscn (主场景)
├── Camera2D — 鼠标拉动控制，限制X轴偏移范围
├── ParallaxBackground — 多层星空背景
├── Starship.tscn — 星舰场景
│   ├── StarshipBody (Sprite2D + CollisionShape2D)
│   ├── MainTurret.gd — 主炮
│   ├── TurretSlot × 12 — 小炮槽位
│   ├── HangarBay × 4 — 停机坪
│   ├── RepairBay — 修理平台
│   └── ShipHUD — HP和模块状态
├── EnemySpawner.gd — 读取WaveData.tres，实例化敌人
├── GameManager (AutoLoad单例)
│   ├── 关卡状态管理
│   ├── 升级商店 (UpgradeShop.tscn)
│   └── 资源管理
└── HUD.gd — 得分、波次、弹药UI
```

## 实体职责

### Starship.gd
- 职责: 星舰总HP管理、模块挂载点
- Signal: `ship_damaged(amount)`, `ship_destroyed`
- 不可移动出关卡范围，是场景锚点

### MainTurret.gd
- 职责: 跟随鼠标角度、点击射击、主炮HP
- 依赖: Camera2D（获取鼠标世界坐标）、Bullet预制体
- Signal: `turret_destroyed`
- 主炮HP归零时被摧毁，不影响其他模块
- 无限弹药，伤害为小炮的3倍

### TurretSlot.gd (×12)
- 职责: 加载WeaponData资源、射击循环、HP管理
- 输入: WeaponData.tres（伤害/射速/射程/弹道类型）
- Signal: `slot_empty`, `slot_damaged`, `slot_destroyed`
- 支持三种武器类型: Cannon / Missile / Laser

### HangarBay.gd (最多4个)
- 职责: 存储战斗机、按序释放、回收
- 属性: `max_fighters = 4`, `current_fighters`
- 战斗机: Fighter.gd 独立场景，AI自主攻击
- Signal: `fighter_released`, `fighter_destroyed`
- 停机坪本身不可被摧毁

### RepairBay.gd (1个)
- 职责: 调度修理机器人，自动寻找最低HP目标
- 机器人: RepairRobot.gd，不可被摧毁
- Signal: `repair_started`, `repair_completed`
- 修理速率由 Resource 配置
- 最多释放12个修理机器人
- 修理平台本身不可被摧毁

### Enemy.gd (基类)
- 职责: HP、移动模式、攻击行为、掉落资源
- 移动: 从右向左，不同敌人有不同路径
- Signal: `enemy_destroyed(resource_amount)`

## 武器系统

### WeaponData.tres (基类Resource)
| 属性 | 类型 | 说明 |
|------|------|------|
| damage | float | 基础伤害 |
| fire_rate | float | 射击间隔(秒) |
| range | float | 射程 |
| projectile_speed | float | 弹速(火炮/导弹) |
| energy_cost | float | 每次射击耗能 |
| upgrade_levels | Array | 升级档位 |

### 三种武器

| | Cannon | Missile | Laser |
|---|--------|---------|-------|
| 弹道 | 直线 | 追踪2秒 | 射线检测 |
| 伤害 | 中等 | 高(含AOE) | 低(持续) |
| 特殊 | 无 | 可被拦截 | 耗能高 |

### 战斗循环
1. TurretSlot 每帧检查 `fire_timer`，到0且有敌人在射程内 → 射击
2. 根据武器类型实例化对应预制体（Cannon: Area2D碰撞 / Missile: 追踪+AOE / Laser: RayCast2D持续伤害）
3. HP <= 0 → 触发 destroyed Signal → 爆炸特效 → `queue_free()`

## 关卡与升级

### 关卡流程
```
开始 → 关卡加载 → 战斗阶段 → 胜利 → 结算 → 升级商店 → 下一关
                                     ↓
                                 失败 → 重试/返回
```

### WaveData.tres (每关配置)
- `level`: 关卡编号
- `waves`: Array[WaveConfig] — 波次配置
- `boss`: PackedScene — Boss预制体(可选)
- `reward`: int — 通关资源奖励
- `background`: Texture — 背景贴图

### 升级商店
可升级项目:
- 火炮/导弹/激光伤害 +20%
- 解锁新武器类型
- 解锁新停机坪
- 修理速率 +10%
- 星舰最大HP +1000

升级数据持久化保存到 SaveData.tres

## 美术风格

写实科幻风：金属灰主体、蓝色高光、引擎火焰橙红色。太空战场环境，有小行星、空间站废墟等障碍物。

## 通信方式

| 范围 | 方式 | 示例 |
|------|------|------|
| 模块间 | Signal | `ship_damaged` → HUD更新 |
| 全局事件 | GameManager AutoLoad | `wave_complete`, `game_over` |
| 配置数据 | Resource 文件 | 武器属性、敌人配置 |
| 持久化 | ConfigFile / JSON | 升级存档 |

## 验证方式

1. 启动 Godot 项目，确认主场景正常加载
2. 测试主炮跟随鼠标、射击、命中敌人
3. 测试三种武器类型的弹道和伤害
4. 测试停机坪释放战斗机的AI行为
5. 测试修理机器人的自动修理逻辑
6. 测试视角拉动范围和边界限制
7. 测试关卡流程和升级商店
8. 测试存档加载
