# WFill AI 狼人杀

WFill 是一个面向多模型 API 的 AI 狼人杀项目。模型作为玩家参与对局，确定性规则引擎负责身份分配、阶段推进、合法性校验、信息隔离与胜负裁决。

当前已完成第一阶段的 6 人无警长确定性规则引擎基础，包括身份分配、夜间技能、白天发言、投票、遗言、死亡与胜负结算。模型 API、持久化和正式 UI 尚未接入。

## 已确定原则

- 第一版为 6 人无警长 AI 自动对局，人类可以全程观战。
- 观战支持公开视角、跟随指定角色视角和上帝视角。
- 狼人夜间聊天只对狼人和上帝视角开放。
- 不展示模型的思维链、隐藏提示词或 API 原始响应。
- 每个座位未来可以选择已配置密钥的 AI 模型，或切换为真人玩家。
- 6 人局无警长；12 人局启用警长。其他人数由具体版型决定。
- 角色、技能、版型、结算与可见性必须模块化并独立版本化。

## 本地验证

```powershell
pnpm install
pnpm test
pnpm typecheck
```

其中 `packages/game-engine/test/full-game.test.ts` 会运行两局固定种子的完整 6 人对局，分别验证好人胜利和狼人胜利，并在每条已接受命令后检查引擎不变量。该结果只是无网络、无 API 的模拟规则引擎证明，不代表真实 AI 模型的游戏表现。

## 文档入口

- [规则库说明](docs/rules/README.md)
- [基础角色卡](docs/rules/roles/base-roles.md)
- [规则选项](docs/rules/core/rule-options.md)
- [版型约束](docs/rules/rulesets/player-count-policy.md)
- [首版 6 人无警长版型](docs/rules/rulesets/6-player-no-sheriff.md)
- [模型与密钥边界](docs/architecture/model-provider-boundary.md)
- [整体设计文档](docs/superpowers/specs/2026-08-22-ai-werewolf-design.md)
