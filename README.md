# WFill AI 狼人杀

WFill 是一个面向多模型 API 的 AI 狼人杀项目。模型作为玩家参与对局，确定性规则引擎负责身份分配、阶段推进、合法性校验、信息隔离与胜负裁决。

当前已完成 6 人无警长确定性规则引擎，以及本地会话后端：SQLite 持久化与审计恢复、自动/暂停/单步控制、公开/指定座位/上帝视角投影、REST 与 SSE 断线续传。当前玩家仍是固定脚本控制器，尚未调用真实模型，也尚未提供 React UI。

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
pnpm build
```

其中完整对局测试会运行固定种子的好人胜局和狼人胜局；黑盒测试还会启动编译后的 Node 服务、完成对局、关闭进程并从同一 SQLite 文件恢复。该结果只是无网络、无 API 的脚本控制器证明，不代表真实 AI 模型的游戏表现。

## 启动本地后端

```powershell
pnpm install
pnpm build
pnpm start:server
```

默认监听 `http://127.0.0.1:3210`，健康检查为 `GET /health`，数据写入 `data/local/wfill.sqlite`。可用 `WFILL_HOST`、`WFILL_PORT`、`WFILL_DATA_DIR` 修改非敏感运行设置。

当前演示局只接受两个确定性种子：

```powershell
curl.exe -X POST http://127.0.0.1:3210/api/sessions -H "Content-Type: application/json" -d '{\"gameId\":\"demo-1\",\"seed\":\"good-win\"}'
curl.exe -X POST http://127.0.0.1:3210/api/sessions/demo-1/control -H "Content-Type: application/json" -d '{\"type\":\"resume\"}'
curl.exe http://127.0.0.1:3210/api/sessions/demo-1
```

控制类型为 `start`、`pause`、`resume`、`step`。事件流地址为 `/api/sessions/:gameId/events?view=public|god|seat:<编号>`，支持标准 `Last-Event-ID` 续传。

停止服务后，如需重置本地演示数据，可删除明确目标目录 `data/local`；该目录只包含本地运行数据，不进入 Git。API Key 仍未接入，当前版本不读取或保存任何密钥。

## 文档入口

- [规则库说明](docs/rules/README.md)
- [基础角色卡](docs/rules/roles/base-roles.md)
- [规则选项](docs/rules/core/rule-options.md)
- [版型约束](docs/rules/rulesets/player-count-policy.md)
- [首版 6 人无警长版型](docs/rules/rulesets/6-player-no-sheriff.md)
- [模型与密钥边界](docs/architecture/model-provider-boundary.md)
- [整体设计文档](docs/superpowers/specs/2026-08-22-ai-werewolf-design.md)
- [本地会话后端规格](docs/superpowers/specs/2026-08-22-local-ai-gameplay-design.md)
- [本地会话实现计划](docs/superpowers/plans/2026-08-22-local-session-orchestration.md)
