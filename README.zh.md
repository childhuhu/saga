# Saga — OpenClaw 长任务 Harness

> 一个基于 skill 路由的长任务 harness，把多阶段工作改造成 continue-site 协调器，配合级联恢复、可检查点的状态、以及由数据驱动的评估器。不修改 OpenClaw 核心代码。

[English](README.md) · 中文

---

## 目录

1. [为什么需要 Saga](#1-为什么需要-saga)
2. [长任务的八种失败模式](#2-长任务的八种失败模式)
3. [关键特性](#3-关键特性)
4. [整体结构](#4-整体结构)
5. [安装](#5-安装)
6. [一次 saga 完整跑下来](#6-一次-saga-完整跑下来)
7. [使用方式](#7-使用方式)
8. [工具](#8-工具)
9. [内置 Profile](#9-内置-profile)
10. [磁盘布局](#10-磁盘布局)
11. [文档](#11-文档)
12. [License](#12-license)

---

## 1. 为什么需要 Saga

长任务的交付质量并不主要取决于模型能力，而取决于围绕模型搭起来的 harness——上下文管理、阶段结构、验证回路、恢复机制。Saga 就是这个 harness，被打包成一个零修改的 OpenClaw 插件：planner → worker-as-injection → hard checks → 可选的 deep evaluator → 级联恢复，所有可信状态都在磁盘上，而不是在聊天历史里。短任务完全不受影响；同一套 runtime 服务于 ops、research、curation、review，以及任何可以用声明式 profile 描述的任务领域。

---

## 2. 长任务的八种失败模式

短任务里 LLM 通常表现良好；一旦任务跨小时、跨多个会话，八种失败模式会反复出现。Saga 为每一种都准备了对应机制。

| # | 失败模式 | 描述 | Saga 对策 |
|---|---|---|---|
| 1 | **一次性冲到底** | 模型试图在一轮里完成整个任务，输出看起来完整但内容很浅。 | Planner 把目标解析为一组带显式 done-criteria 的 stage（loose YAML stage-spec）；worker 通过 `workerContext` 注入，只看到当前 stage 的目标和需要产出的 artifact。 |
| 2 | **过早宣告完成** | 模型判断"差不多了"就停止。 | 每个 stage 提交的 artifacts 先跑 hard checks（file-exists / file-size-gt / free-form 等）；只有底线通过后才进入主观评估。 |
| 3 | **上下文漂移 / 焦虑** | 上下文越长，模型越仓促、越容易跳过验证、甚至幻觉。 | microcompact-retry 恢复层把过去的 eval 结果压缩成 200 字符摘要；级联恢复用一段干净的新 prompt 重新注入 worker，而不是让原有上下文继续膨胀。 |
| 4 | **自评失真** | 让做事的模型评自己几乎一定会虚高。 | deep evaluator 在独立的一轮里运行，由 profile JSON 的 checklist 渲染出固定模板（H1/H2/H3 硬项 + S1–S4 软项），强制输出结构化 JSON verdict，而不是自由发挥。 |
| 5 | **不可恢复的中断** | 中断后任务无法干净恢复。 | 所有状态都在磁盘 `runs/<sagaId>/` 下。`resumeSaga` 读 `state.json`（如果丢了，就重放 `events.jsonl`）然后回到同一个 `advance()` 主循环——不依赖聊天历史。 |
| 6 | **非结构化交接** | 下一任 agent 看不清哪些做完了、哪些没做、什么算完成。 | 每个 stage 自带 `doneCriteria` 数组；worker 通过 `artifacts: [{path, content}]` 提交，evaluator 看到的就是 worker 提交的同一段字节。 |
| 7 | **缺乏外部验证** | 质量判断完全依赖 LLM 自评，没有任何机器可裁决的证据。 | done-criteria 中的机器可检查类型（`file-exists`、`file-size-gt`、`command`、`file-schema`、`progress-items`、`browser`、`log-scan`、`metrics`）在 deep 评估之前先跑 hard checks。`free-form` 才交给 LLM。 |
| 8 | **任务级可观测性差** | 没有持久的、有顺序的记录。 | 每一次状态变更都写入 append-only 的 `events.jsonl`：`saga_created`、`plan_produced`、`worker_mode_queued`、`eval_completed`、`recovery_attempt`、`stage_advanced`、`saga_terminated`。 |

### 三个值得展开看的机制

上面那张表每一行只有一句话。其中三条对策在工程上承担的重量比看起来大得多，值得展开。

**Artifact 只能通过单一通道流动，worker 不直写文件系统。** Worker 完成 stage 时不能用 `write` 工具落盘——它必须调 `saga_advance(workerFinished=true, artifacts=[{path, content}])`，harness 才把字节写到 `runs/<sagaId>/artifacts/<path>`，evaluator 也从那里读。**不存在 worker 写了文件但 evaluator 看不见**这种故障模式（模型常见的"宣称交付了但字节没到位"陷阱）。这条单向通道是被 worker-mode 注入提示强制的："Do NOT use the `write` tool; pass everything through the `artifacts` parameter."

**Deep evaluator 返回结构化 verdict，不允许自由发挥。** 当 `evaluatorMode === 'deep'`，harness 从 profile JSON 渲染出一个 checklist prompt：每个 hard 项（H1/H2/H3）都带显式的 PASS / FAIL-REWORK / FAIL-ESCALATE 描述，每个 soft 项（S1–S4）配 1–5 分的评分指引。agent 必须以 `{ passed, score, issues, escalate }` 的形式提交。`escalate: true` 专门留给"以现有信息这条 criterion 结构性达不到"——它会把 saga 转入 `awaiting_human`，而**不是**进入恢复循环。"返工可达" vs "结构性不可达"这个区分是 LLM 评分员被简单 prompt 后最容易拍扁的差别；checklist 让模型把它保留下来。

**状态原子写 + event log 可以从零重建状态。** 每一次状态变更写的都是**整份** `state.json`：先写到 `.tmp` 文件再 rename 覆盖。没有补丁、没有 diff、没有并发写——要么新状态完整在盘上，要么老状态原封不动。万一 `state.json` 整个丢了（损坏、误删），`resumeSaga` 会重放 `events.jsonl`，重建出同一份 `SagaState`。这就是"中间崩了明天接着跑"在工程上真的成立的原因，而不是依赖 agent 还记得自己刚才在做什么。

---

## 3. 关键特性

- **纯 skill 路由触发。** Host LLM 根据每个 `SKILL.md` 的 description 自动匹配；没有关键词启发式、没有 per-agent hook 配置。
- **Continue-site 协调器。** `coordinator/advance.ts` 是唯一的 dispatcher。每个 `if` 块就是一个 continue-site。新增一种恢复路径 = 新增一个 `if`。没有 enum，没有 switch。
- **Loose YAML stage-spec。** Planner 输出带嵌入 YAML 的 markdown；parser 会规范化字段名、缺字段用 `free-form` 兜底，而不是直接报错。
- **Worker-as-injection。** 不开新的 sub-agent。每次 stage 推进时，把 worker-mode 提示块（stage 目标 + 需提交的 artifact 路径 + 每个 profile 对应的工具提示）注入到下一轮 agent。worker 完成后通过 `saga_advance` 的 `artifacts` 参数提交结果。
- **级联恢复。** 每个 stage 的失败链路：fix-attempt（×2）→ microcompact-retry → full-rework → terminal。每一层对应一种 `Transition` 类型和一个 continue-site。
- **数据驱动的 deep evaluator。** 代码里没有 per-profile 分支——`roles/evaluator-deep.ts` 从 profile JSON 的 `evaluator.checklist` 渲染出唯一模板，再加上 few-shot calibration 文件。
- **根因分类器。** 失败会被检查是否匹配终结模式（`source_unavailable`、`model_capability_exceeded`、`network_transient`、`information_unavailable`），匹配则短路到终结原因，或路由到 `awaiting_human`，否则才进入恢复级联。
- **崩溃安全恢复。** `state.json` 是整对象原子写（tmp → rename）；即便丢失，`events.jsonl` 也足够重建。
- **五个内置 profile。** `ops`、`research`、`curation`、`review`、`generic`——每个都自带 evaluator checklist、few-shot 校准、允许的 hard-check 种类、澄清轮数。

---

## 4. 整体结构

```
Host agent
   │  (skill 路由：如 saga-research、saga-ops)
   ▼
saga_start ──► coordinator/advance.ts (continue-site 主循环)
                  │
                  ├─ 没有 plan?     → planner（向 agent 返回 planYaml prompt）
                  ├─ 收到 plan      → 队列化 stage 0 的 worker-mode 注入
                  ├─ workerFinished → runHardChecks(stage.doneCriteria)
                  │                     ├─ 全部通过 + evaluatorMode='auto'  → cursor 推进
                  │                     ├─ 全部通过 + evaluatorMode='deep'  → 构造 deep eval prompt 让 agent 提交 evalResult
                  │                     └─ 有失败 → classifyHardCheckFailure → 进入级联恢复
                  ├─ 恢复：fix-attempt ×2 → microcompact-retry → full-rework → terminal
                  └─ 所有 stage 完成 → terminate(completed)
                                          │
                                          └─（仅 ops profile）向 ops-memory 追加一条记录
```

所有状态都在磁盘：

```
<stateRoot>/runs/<sagaId>/
  state.json     # 当前快照（原子写）
  events.jsonl   # append-only 事件流
  artifacts/     # worker 通过 artifacts 参数提交的产物
```

`stateRoot` 默认是 `<openclaw-config>/workspace/saga/.saga`（由 `api.rootDir` 派生），与插件安装位置解耦。

---

## 5. 安装

### 通过 npm（推荐）

```bash
openclaw plugins install openclaw-plugin-saga
openclaw gateway restart
```

固定版本：

```bash
openclaw plugins install openclaw-plugin-saga --pin
```

### 通过 GitHub Release tarball（不需要 npm）

```bash
curl -L https://github.com/childhuhu/saga/releases/latest/download/openclaw-plugin-saga.tgz \
  -o /tmp/openclaw-plugin-saga.tgz
openclaw plugins install /tmp/openclaw-plugin-saga.tgz
openclaw gateway restart
```

指定版本（替换 `v1.0.0` 和文件名中的版本号）：

```bash
curl -L https://github.com/childhuhu/saga/releases/download/v1.0.0/openclaw-plugin-saga-1.0.0.tgz \
  -o /tmp/openclaw-plugin-saga.tgz
```

### 从源码构建（贡献者）

```bash
npm install
npm run build
npm test           # 172 个单测，约 3 秒
```

`npm test` 跑的是 `test/` 下 20 个单测文件。LLM 回归测试是独立的本地工作流（见 [`CONTRIBUTING.md`](CONTRIBUTING.md)），不打进发布包，也不进 CI。

自己打 tarball：

```bash
npm pack
openclaw plugins install ./openclaw-plugin-saga-<version>.tgz
openclaw gateway restart
```

### 插件配置（可选）

```json
{
  "stateRoot": "/absolute/path/for/saga/runs"
}
```

不设置时默认为 `<openclaw-config>/workspace/saga/.saga`（从 `api.rootDir` 派生，与插件 tarball 安装位置解耦）。

---

## 6. 一次 saga 完整跑下来

下面是一次典型的研究 saga，从用户视角和 harness 视角同时看。

**用户输入：** *"调研一下国内主要 LLM 工具厂商的产品定位和差异化。"*

1. **Skill 路由。** host LLM 匹配到 `saga-research`（description 开头是 "Run a multi-stage research saga…"）。skill 指令告诉它先问 `clarificationRounds=2` 轮澄清问题再调 `saga_start`。

2. **澄清阶段。** agent 问 Q1（*"内部资料 / 公开网络 / 两者都用？"*）和 Q2（*"交付形式是什么——自由格式报告、对比表格、executive summary，还是其它？"*）。用户回答后，agent 调 `saga_start(profile="research", goal=<用户原话 + 澄清答案逐字保留>)`。

3. **Planner。** `saga_start` 返回 `{ status: "plan_required", planPrompt: "..." }`。agent 自己生成一份带嵌入 YAML 的 markdown 计划——典型是 3–5 个 stage，每个带 `done:` 列出所需 artifact 和 `evaluator: deep`。agent 先把计划打给用户看（📋 + stage 列表），再调 `saga_advance(sagaId, planYaml=<计划>)`。

4. **Stage 1 worker mode。** `saga_advance` 返回 `{ nextAction: "worker_mode_queued", stageId: "stage-01", workerContext: "..." }`。`workerContext` 是预先拼好的一段 prompt，包含 stage 目标、需要提交的 artifact 路径、profile 对应的工具提示（如 *"Use read, web_fetch, web_search to gather sources"*）、以及一行 agent 用来宣告进度的模板（`▶ Stage 1/4 开始：...`）。agent 干活，做完调 `saga_advance(workerFinished=true, artifacts=[{path: "stages/stage-01-report.md", content: "..."}])`。

5. **Hard checks。** Saga 跑 `runDoneChecks` 校验提交的 artifact：`file-exists` 确认路径存在，`file-size-gt` 确认不是占位文件。都过且 `evaluatorMode === 'deep'` → 返回 `{ nextAction: "eval_deep_required", evalPrompt: "<H1/H2/H3 + S1–S4 checklist>" }`。

6. **Deep eval。** agent（在一轮全新的、不带 worker 上下文残留的对话里）读 checklist，提交 `saga_advance(evalResult={ passed, score, issues, escalate })`。pass → cursor 推进；返工可达的 fail → 进入恢复级联；结构性达不到 → 进 `awaiting_human`，附带 diagnostic 让 agent 念给用户听。

7. **Stage 2–N。** 同样的循环。agent 每次只看到当前 stage 的 worker context——它不用记 stage 1..N-1，因为 harness 每次都会把对的上下文重新注入。

8. **终结。** 最后一个 stage 过了之后，saga 的 `termination.reason` 变成 `completed`。agent 把 `artifacts/` 里的实质内容**直接呈现在对话里**（✅ + 最终汇总），不是只丢一个文件路径。

整条流程都是可观测的：`cat <stateRoot>/runs/<sagaId>/events.jsonl` 会展示每一步 `saga_created → plan_produced → worker_mode_queued → eval_completed → stage_advanced → saga_terminated` 加时间戳。哪里出问题，事件流会说话。

---

## 7. 使用方式

有两条路径进入 harness，最终都汇聚到同一个 `advance()` 主循环。

### Skill 路由（推荐）

自然语言描述你的任务给 host agent。如果 LLM 根据 `SKILL.md` 的 description 匹配到了某个 saga skill（如"调研一下…"→ `saga-research`、"WiFi 又掉了"→ `saga-ops`），skill 会先问该领域的 Q1/Q2 澄清问题，然后用对应 profile 调用 `saga_start`。所有 skill 共享的工作流见 `skills/_shared/saga-workflow.md`。

### 直接调用工具

任何 agent 或测试可以直接调用：

```
saga_start(profile="research", goal="…")
   → 返回 { sagaId, status: "plan_required", planPrompt }

saga_advance(sagaId, planYaml="<带嵌入 YAML 的 markdown 计划>")
   → 返回 { nextAction: "worker_mode_queued", stageId, workerContext, progress }

saga_advance(sagaId, workerFinished=true, artifacts=[{path, content}])
   → 若是 auto evaluator：推进或进入恢复
   → 若是 deep evaluator：返回 { nextAction: "eval_deep_required", evalPrompt }

saga_advance(sagaId, evalResult={ passed, score, issues, escalate })
   → 推进、进入恢复，或上升到 human
```

Plan 格式宽松：markdown 配 `## Stage N: <title>` 标题，每个 stage 跟一个 `` ```yaml `` 块，含 `done:` 数组（kinds：`file-exists`、`file-size-gt`、`command`、`free-form`…）和 `evaluator: auto|deep`。

---

## 8. 工具

四个工具，snake_case 命名：

| 工具 | 作用 |
|---|---|
| `saga_start` | 创建 saga，跑澄清阶段，然后返回 `plan_required`（agent 自行生成 plan 后用 `saga_advance(planYaml=…)` 提交）或 `worker_mode_queued`（stage 0 开始）。 |
| `saga_advance` | 唯一的反复推进入口。接受 `planYaml`、`artifacts`、`evalResult`、`humanInput`、`workerDiagnostics`。返回 `worker_mode_queued`、`continue_worker_now`、`revision_queued`、`eval_deep_required`、`clarification_needed`、`await_human` 或 `terminated`。 |
| `saga_status` | 只读快照：profile、goal、cursor、当前 stage id、transition kind、termination、recoveryAttempts、一行进度摘要。 |
| `saga_cancel` | 写入 `Termination`，reason 为 `aborted_by_user`。磁盘状态保留以便事后排查。 |

**恢复不需要单独的工具**：任何后续的 `saga_advance` 都会读取磁盘上的 `state.json`，从中断处继续 dispatch。若 `state.json` 丢失，`resumeSaga` 会从 `events.jsonl` 重建状态。

---

## 9. 内置 Profile

| Profile | 领域 | Evaluator | 允许的 hard-check 种类 | 澄清轮数 |
|---|---|---|---|---|
| `ops` | 家用/个人基础设施运维（网络诊断、设备配置、反复出现的问题） | deep | `command`、`file-exists`、`free-form` | 2 |
| `research` | 深度调研 / 文献综合 | deep | `file-exists`、`file-size-gt`、`progress-items`、`free-form` | 2 |
| `curation` | 批量数据任务（分类、打分、过滤、结构化输出） | auto | `file-exists`、`file-size-gt`、`file-schema`、`free-form` | 1 |
| `review` | 独立多轮评审某份产物 | deep | `file-exists`、`free-form` | 1 |
| `generic` | 多步骤工作的兜底 | auto | 所有种类 | 1 |

每个 profile 配套：

- `profiles/<id>-default.json` —— 声明 `evaluator.checklist`（`hard: H1/H2/H3` + 带权重的 `soft: S1–S4`），以及 few-shot 校准文件指针
- `data/few-shot-rubrics/<id>.md` —— PASS / FAIL-REWORK / FAIL-ESCALATE 三种 worked example
- `src/prompts/worker-tools-<id>.md` —— 注入到 worker context 里的工具提示
- `src/prompts/planner-examples-<id>.md` —— planner 的 few-shot
- `skills/saga-<id>/SKILL.md` —— 领域专属的 Q1/Q2 + 交付格式

### 各 profile 的 checklist 一览

Hard checklist 是 deep evaluator（或 `auto` 兜底）每个 stage 必须核对的硬项。Soft 项只影响 1–5 分加权得分，不决定 pass/fail。

**`research`** —— H1 引用就位（来源可识别） · H2 目标被具体地回答 · H3 ≥5 条可核实事实（人名/日期/数字）。Soft（S1–S4）：来源多样性 0.3，分析深度 0.3，可执行结论 0.2，清晰度 0.2。交付：markdown 报告，含 `## References` 段落。

**`ops`** —— H1 诊断有依据（每个论断都有 `command` hard-check 兜底） · H2 修改可逆（每条变更命令都有对应的 revert，或者明确声明它是单向的） · H3 写入 memory（终结 stage 向 OpenClaw memory 追加一条记录）。Soft：诊断完整度 0.4，风险意识 0.3，memory 条目质量 0.2，清晰度 0.1。交付：`diagnosis.md` + `runbook.md`。完成时 `appendOpsMemoryEntry` 自动触发。

**`curation`** —— H1 Schema 合规（每条输出都通过校验） · H2 覆盖度达到声明阈值 · H3 主观打分有校准（抽查 ≥3 条记录）。Soft：schema 正确性 0.3，打分一致性 0.3，覆盖度 0.2，组织 0.2。交付：按声明 schema 的 JSONL/CSV + 一份 `summary.md` 含分布统计。

**`review`** —— H1 Finding 引用产物（带引文或精确位置） · H2 严重等级标注（blocker/major/minor/nit + 一句话理由） · H3 覆盖范围明示（检查了什么 + 明确没检查什么）。Soft：洞察深度 0.4，等级校准 0.2，覆盖广度 0.2，可行动性 0.2。交付：一份 `review.md`。**只读设计** —— 不允许 `command` hard-check。

**`generic`** —— H1 回应目标 · H2 自包含（没看过聊天的人也能直接读懂） · H3 done-criteria 与原计划吻合（无范围漂移）。Soft：完整性 0.3，质量 0.3，清晰度 0.2，相关性 0.2。交付：自由格式，在计划里声明。

### 新增 profile

新增 profile 需要：在 `src/profiles/index.ts` 加一条 `ProfileDefinition`、在 `profiles/` 加 JSON、补齐三份 prompt/rubric、再加一个 skill 目录。`test/profile-config.test.ts` 会保证每个 profile 都齐全——少一个文件，跑测试会精确报错说缺啥。

---

## 10. 磁盘布局

```
<stateRoot>/runs/<sagaId>/
  state.json                        # 当前快照
  events.jsonl                      # append-only 事件流
  artifacts/
    <worker 提交的内容>
    stages/
      stage-01-report.md            # 如果按此路径提交
      …
```

`state.json` 的 schema 是 `src/coordinator/state.ts` 里的 `SagaState`；事件类型见同文件的 `SagaEvent` 联合。

---

## 11. 文档

- [`docs/zh/codebase-walkthrough.md`](docs/zh/codebase-walkthrough.md) —— 中文学习指南：以这个仓库为案例讲清楚长任务 harness 的设计动因，以及这些设计落在了哪些文件里
- [`CLAUDE.md`](CLAUDE.md) —— 给 AI 协作者的仓库指南

---

## 12. License

MIT.
