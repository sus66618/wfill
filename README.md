# WFill AI 狼人杀

WFill 是一个面向多模型 API 的 AI 狼人杀项目。模型作为玩家参与对局，确定性规则引擎负责身份分配、阶段推进、合法性校验、信息隔离与胜负裁决。

当前阶段只建设规则与架构文档，不包含游戏代码和模型 API 接入。

## 已确定原则

- 第一版为 6 人无警长 AI 自动对局，人类可以全程观战。
- 观战支持公开视角、跟随指定角色视角和上帝视角。
- 狼人夜间聊天只对狼人和上帝视角开放。
- 不展示模型的思维链、隐藏提示词或 API 原始响应。
- 每个座位未来可以选择已配置密钥的 AI 模型，或切换为真人玩家。
- 6 人局无警长；12 人局启用警长。其他人数由具体版型决定。
- 角色、技能、版型、结算与可见性必须模块化并独立版本化。

## 文档入口

- [规则库说明](docs/rules/README.md)
- [基础角色卡](docs/rules/roles/base-roles.md)
- [规则选项](docs/rules/core/rule-options.md)
- [版型约束](docs/rules/rulesets/player-count-policy.md)
- [首版 6 人无警长版型](docs/rules/rulesets/6-player-no-sheriff.md)
- [模型与密钥边界](docs/architecture/model-provider-boundary.md)
- [整体设计文档](docs/superpowers/specs/2026-08-22-ai-werewolf-design.md)
