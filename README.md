# WFill AI 狼人杀

WFill 是一个面向多模型 API 的 AI 狼人杀项目。模型作为玩家参与对局，确定性规则引擎负责身份分配、阶段推进、合法性校验、信息隔离与胜负裁决。

当前已完成 6 人无警长确定性规则引擎、本地会话后端和 OpenAI-Compatible 模型玩家链路：SQLite 持久化与审计恢复、自动/暂停/单步控制、公开/指定座位/上帝视角投影、REST 与 SSE 断线续传。React UI 是下一阶段。

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

在仓库根目录创建 `.env`（已被 Git 忽略），只在注释下方填写真实值：

```dotenv
# 学校统一网关地址；聊天请求会自动追加 /chat/completions
WFILL_SCHOOL_API_BASE_URL=http://aigw.dlut.edu.cn/v1

# 在下一行等号右侧填写你的 API Key；禁止提交、截图或发到聊天中
WFILL_SCHOOL_API_KEY=请在这里填写真实密钥
```

```powershell
pnpm install
pnpm build
pnpm start:server
```

默认监听 `http://127.0.0.1:3210`，健康检查为 `GET /health`，数据写入 `data/local/wfill.sqlite`。可用 `WFILL_HOST`、`WFILL_PORT`、`WFILL_DATA_DIR` 修改非敏感运行设置。

先检查模型目录和健康状态：

```powershell
curl.exe http://127.0.0.1:3210/api/models
curl.exe -X POST http://127.0.0.1:3210/api/models/Qwen3.5-9B/check
```

首版可选文本模型为 `Qwen3.5-9B`、`Qwen3.5-35B-A3B`、`Qwen3.5-122B-A10B`、`DeepSeek-V3.1-W8A8`、`GLM-4.6-W8A8`、`MiniMax-M2.7-bf16`、`Qwen3-235B-A22B`。模型必须先通过健康检查，六个座位可以混用或复用健康模型。

创建模型对局：

```powershell
$body = @{
  gameId = "model-1"
  controller = "models"
  seats = 1..6 | ForEach-Object { @{ seat = $_; accountId = "school-account"; modelId = "Qwen3.5-9B" } }
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3210/api/sessions -ContentType application/json -Body $body
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3210/api/sessions/model-1/control -ContentType application/json -Body '{"type":"resume"}'
```

固定脚本演示局仍可用于零额度回归：

```powershell
curl.exe -X POST http://127.0.0.1:3210/api/sessions -H "Content-Type: application/json" -d '{\"gameId\":\"demo-1\",\"seed\":\"good-win\"}'
curl.exe -X POST http://127.0.0.1:3210/api/sessions/demo-1/control -H "Content-Type: application/json" -d '{\"type\":\"resume\"}'
curl.exe http://127.0.0.1:3210/api/sessions/demo-1
```

控制类型为 `start`、`pause`、`resume`、`step`。事件流地址为 `/api/sessions/:gameId/events?view=public|god|seat:<编号>`，支持标准 `Last-Event-ID` 续传。

停止服务后，如需重置本地演示数据，可删除明确目标目录 `data/local`；该目录只包含本地运行数据，不进入 Git。API Key 只从进程环境读取，不进入 SQLite、事件、提示词、日志或响应。

## 真实网关验收（会消耗额度）

普通 `pnpm test` 永远跳过真实网络测试。先只做一次低成本健康调用：

```powershell
$env:WFILL_RUN_LIVE_MODEL_TESTS="1"
pnpm test:live-model
Remove-Item Env:WFILL_RUN_LIVE_MODEL_TESTS
```

确认健康后才运行完整对局；默认复用 `Qwen3.5-9B`，可通过 `WFILL_LIVE_MODEL_ID` 更换：

```powershell
$env:WFILL_RUN_LIVE_MODEL_TESTS="1"
$env:WFILL_RUN_LIVE_MODEL_GAME="1"
pnpm test:live-model
Remove-Item Env:WFILL_RUN_LIVE_MODEL_TESTS, Env:WFILL_RUN_LIVE_MODEL_GAME
```

完整验收设有 300 次模型调用和 100,000 Token 硬上限。测试不会打印密钥、提示词或模型原始发言。

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
