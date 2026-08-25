# WFill AI 狼人杀

WFill 是一个让多个文本模型作为玩家参与狼人杀对局的后端实验项目。AI 负责发言和选择行动，确定性规则引擎负责身份分配、阶段推进、合法性校验、信息隔离、投票、技能结算和胜负判定。

项目当前完成了 6 人无警长版型、自动对局后端、OpenAI-Compatible 模型接入、SQLite 持久化、REST API 和 SSE 事件流；可视化前端尚未实现。

## 开发方式与职责说明

本项目采用 **AI 辅助的 vibecoding 工作流**开发。

- 本人提出产品目标，参与确定玩法规则、系统边界、功能取舍和验收标准。
- AI 参与需求细化、架构设计、代码生成、测试补充、调试和文档整理。
- 仓库中的大量实现并非本人逐行独立手写，公开本项目是为了如实展示一次人机协作的软件工程实践，而不是将 AI 生成代码包装成个人独立编码成果。
- README 中的“已完成”只表示仓库中存在对应实现并通过列出的验证，不代表本人已经独立掌握每个模块的全部细节。

## 为什么需要确定性规则引擎

如果让语言模型同时扮演玩家、主持人和裁判，模型可能越权读取隐藏信息、执行非法动作、改变规则或错误宣布胜负。因此 WFill 采用以下边界：

- AI 只接收当前座位依法可见的信息。
- AI 只能从当前阶段的合法动作中选择。
- 发言只是文本，不会自动产生投票或技能效果。
- 规则引擎是唯一可以改变真实对局状态的模块。
- 系统主持、计票、死亡结算和胜负判断均由确定性代码完成。
- 不请求、保存或展示模型的思维链和隐藏提示词。

这一设计把模型的不确定性限制在“玩家决策”内，把规则正确性和信息安全留给可测试的软件。

## 当前版型

首个可运行版型为 `six-player-classic-no-sheriff@1.0.0`：

- 2 名狼人
- 2 名村民
- 1 名预言家
- 1 名女巫
- 无警长、暗牌、屠城
- 女巫不可自救、不可同夜使用两瓶药
- 首次平票进入 PK，再次平票无人出局
- 选票收齐后统一公开，避免模型调用顺序造成信息优势

狼人杀规则在不同平台之间存在差异，因此项目通过带版本号的版型固定规则，不声称这是唯一的 6 人玩法。完整规则见 [`docs/rules`](./docs/rules/README.md)。

## 已实现功能

### 对局内核

- 确定性身份分配与随机种子
- 夜晚、黎明、白天、投票和结算状态推进
- 狼刀、预言家查验、女巫用药、放逐与胜负判断
- 合法动作查询、命令校验和非法操作拒绝
- 完整事件日志与事件重放

### 信息隔离

- 公开视角：只显示公开发言、投票和系统结果
- 指定座位视角：额外显示该玩家依法可见的身份、技能和私有结果
- 上帝视角：显示全部身份、夜间行动和狼人交流
- 狼人夜间交流只对存活狼人和上帝视角开放
- 后端完成信息投影，不把完整状态交给前端后再隐藏

### 模型玩家

- OpenAI-Compatible Chat Completions 接口
- 按座位选择模型，同一模型可复用到多个座位
- 结构化行动解析与 Zod 校验
- 超时、失败和非法回复的确定性降级策略
- 发言长度与单局调用、Token 上限
- API Key 只从进程环境读取，不写入 Git、SQLite、事件或响应

### 服务与持久化

- Fastify REST API
- SSE 对局事件流与 `Last-Event-ID` 续传
- 自动、暂停、继续和单步执行
- SQLite 保存会话、事件、更新日志和非敏感模型配置
- 服务重启后从持久化数据恢复对局

## 架构

项目采用 TypeScript、pnpm workspace 和模块化单体结构：

```text
模型 API / 脚本控制器
          │
          ▼
   application 编排层
     │       │       │
     ▼       ▼       ▼
game-engine 视图投影 model-gateway
     │                   │
     ▼                   ▼
rules-core          外部模型服务
     │
     ▼
contracts ← persistence(SQLite) ← server(REST/SSE)
```

| 模块 | 职责 |
| --- | --- |
| `packages/contracts` | 命令、事件、ID 和应用层协议 |
| `packages/rules-core` | 角色、版型及规则校验 |
| `packages/game-engine` | 状态转换、行动合法性、结算和胜负判断 |
| `packages/application` | 会话编排、玩家控制器、提示词和安全视图 |
| `packages/model-gateway` | 模型目录、凭据读取及 OpenAI-Compatible 客户端 |
| `packages/persistence` | SQLite 仓储、迁移和恢复 |
| `apps/server` | HTTP API、SSE 和运行时会话注册 |

详细设计记录位于 [`docs/superpowers/specs`](./docs/superpowers/specs/2026-08-22-ai-werewolf-design.md)。设计文档包含部分未来规划，判断当前能力时应以源码、测试和本 README 的“当前状态”为准。

## 本地运行

### 环境要求

- Node.js 22
- pnpm

安装依赖并运行离线验证：

```bash
pnpm install
pnpm test
pnpm typecheck
```

启动本地后端：

```bash
pnpm build
pnpm start:server
```

默认监听 `http://127.0.0.1:3210`，健康检查地址为：

```text
GET http://127.0.0.1:3210/health
```

可使用 `WFILL_HOST`、`WFILL_PORT` 和 `WFILL_DATA_DIR` 修改监听地址、端口和本地数据目录。

## 配置真实模型

在仓库根目录创建不会进入 Git 的 `.env`：

```dotenv
WFILL_SCHOOL_API_BASE_URL=https://example.com/v1
WFILL_SCHOOL_API_KEY=your-key-here
```

不要提交、截图或在 Issue 中粘贴真实 API Key。当前环境变量名称源于项目最初使用的学校统一网关，但接口遵循 OpenAI-Compatible 格式。

启动服务后可检查模型目录和健康状态：

```bash
curl http://127.0.0.1:3210/api/models
curl -X POST http://127.0.0.1:3210/api/models/Qwen3.5-9B/check
```

可用模型由当前源码中的安全目录限定，并且必须先通过健康检查。模型目录可能随网关能力变化，README 不将某次可用状态视为永久保证。

## 创建演示对局

无需 API 额度的固定脚本局：

```bash
curl -X POST http://127.0.0.1:3210/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"gameId":"demo-1","seed":"good-win"}'

curl -X POST http://127.0.0.1:3210/api/sessions/demo-1/control \
  -H "Content-Type: application/json" \
  -d '{"type":"resume"}'

curl http://127.0.0.1:3210/api/sessions/demo-1
```

控制类型包括 `start`、`pause`、`resume` 和 `step`。事件流地址为：

```text
/api/sessions/:gameId/events?view=public
/api/sessions/:gameId/events?view=god
/api/sessions/:gameId/events?view=seat:<座位号>
```

## 测试边界

普通测试使用固定脚本控制器，不访问模型 API，也不消耗 Token。它们主要验证：

- 规则和状态转换
- 好人、狼人两类完整胜局
- 命令合法性与非法操作拒绝
- 不同视角的信息隔离
- SQLite 持久化、审计恢复和服务重启
- REST、SSE、模型接口及失败降级

这些测试可以证明软件规则和接口行为，但**不能证明真实语言模型的策略水平、角色扮演质量或完整对局稳定性**。

真实模型测试默认关闭，因为会访问外部服务并消耗额度：

```powershell
$env:WFILL_RUN_LIVE_MODEL_TESTS="1"
pnpm test:live-model
Remove-Item Env:WFILL_RUN_LIVE_MODEL_TESTS
```

只有在额外设置 `WFILL_RUN_LIVE_MODEL_GAME=1` 时才执行完整模型对局。该测试设有调用次数和 Token 硬上限，但运行前仍应确认账户额度。

## 当前状态与未完成项

已完成：

- 6 人无警长确定性规则引擎
- 脚本与模型玩家控制器
- 本地会话后端、持久化、恢复和事件流
- 多视角信息投影
- 离线自动化测试和可选真实模型测试入口

尚未完成：

- React 可视化观战界面
- 真人玩家与人机混合对局
- 9 人、12 人和警长版型
- 公网房间、账户系统和云部署
- 长时间、多模型、多局统计意义上的策略评测

## 后续方向

1. 完成 React 观战界面和对局创建流程。
2. 用真实模型执行小规模可复现实验，记录成功率、非法输出和成本。
3. 在不破坏 6 人版型的前提下增加新版型。
4. 最后再评估真人玩家、公网部署和更多角色。

## License

仓库暂未声明开源许可证。代码可供阅读和交流；复制、修改或再发布前，请先联系仓库作者确认授权。
