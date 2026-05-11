# Saga — OpenClaw 长任务 Harness

> 一个基于 skill 路由的长任务 harness，把多阶段工作改造成 continue-site 协调器，配合级联恢复、可检查点的状态、以及由数据驱动的评估器。不修改 OpenClaw 核心代码。

[English](README.md) · 中文

---

## 目录

1. [为什么需要 Saga](#1-为什么需要-saga)
2. [长任务的八种失败模式](#2-长任务的八种失败模式)
3. [关键特性](#3-关键特性)
4. [整体结构](#4-整体结构)
5. [安装与构建](#5-安装与构建)
6. [使用方式](#6-使用方式)
7. [工具](#7-工具)
8. [内置 Profile](#8-内置-profile)
9. [磁盘布局](#9-磁盘布局)
10. [文档](#10-文档)
11. [License](#11-license)

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

## 5. 安装与构建

```bash
npm install
npm run build
npm test
```

预期：172 个单测全部通过（20 个文件）。`test/regression/` 下的回归测试被 `npm test` 排除——它们跑在 Docker 里真实的 OpenClaw gateway 上。

打包发布：

```bash
npm pack
openclaw plugins install openclaw-plugin-saga-<version>.tgz
openclaw gateway restart
```

插件配置（可选，全部字段）：

```json
{
  "stateRoot": "/absolute/path/for/saga/runs"
}
```

不设置时默认为 `<openclaw-config>/workspace/saga/.saga`。

---

## 6. 使用方式

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

## 7. 工具

四个工具，snake_case 命名：

| 工具 | 作用 |
|---|---|
| `saga_start` | 创建 saga，跑澄清阶段，然后返回 `plan_required`（agent 自行生成 plan 后用 `saga_advance(planYaml=…)` 提交）或 `worker_mode_queued`（stage 0 开始）。 |
| `saga_advance` | 唯一的反复推进入口。接受 `planYaml`、`artifacts`、`evalResult`、`humanInput`、`workerDiagnostics`。返回 `worker_mode_queued`、`continue_worker_now`、`revision_queued`、`eval_deep_required`、`clarification_needed`、`await_human` 或 `terminated`。 |
| `saga_status` | 只读快照：profile、goal、cursor、当前 stage id、transition kind、termination、recoveryAttempts、一行进度摘要。 |
| `saga_cancel` | 写入 `Termination`，reason 为 `aborted_by_user`。磁盘状态保留以便事后排查。 |

**恢复不需要单独的工具**：任何后续的 `saga_advance` 都会读取磁盘上的 `state.json`，从中断处继续 dispatch。若 `state.json` 丢失，`resumeSaga` 会从 `events.jsonl` 重建状态。

---

## 8. 内置 Profile

| Profile | 领域 | Evaluator | 允许的 hard-check 种类 | 澄清轮数 |
|---|---|---|---|---|
| `ops` | 家用/个人基础设施运维（网络诊断、设备配置、反复出现的问题） | deep | `command`、`file-exists`、`free-form` | 2 |
| `research` | 深度调研 / 文献综合 | deep | `file-exists`、`file-size-gt`、`progress-items`、`free-form` | 2 |
| `curation` | 批量数据任务（分类、打分、过滤、结构化输出） | auto | `file-exists`、`file-size-gt`、`file-schema`、`free-form` | 1 |
| `review` | 独立多轮评审某份产物 | deep | `file-exists`、`free-form` | 1 |
| `generic` | 多步骤工作的兜底 | auto | 所有种类 | 1 |

每个 profile 配套：

- `<profile>-default.json` —— 声明 `evaluator.checklist`（`hard: H1/H2/H3` + `soft: S1–S4`）和 `evaluator.fewShotCalibrationPath`
- `data/few-shot-rubrics/<profile>.md` —— 工作过的示例文件
- `src/prompts/worker-tools-<profile>.md` —— 注入到 worker context 里的工具提示
- `src/prompts/planner-examples-<profile>.md` —— planner 的 few-shot
- `skills/saga-<profile>/SKILL.md` —— 领域专属的 Q1/Q2 + 交付格式

新增 profile 需要：在 `src/profiles/index.ts` 加一条 `ProfileDefinition`、在 `profiles/` 加 JSON、补齐三份 prompt/rubric、再加一个 skill 目录。`test/profile-config.test.ts` 会保证每个 profile 都齐全。

---

## 9. 磁盘布局

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

## 10. 文档

- [`docs/zh/codebase-walkthrough.md`](docs/zh/codebase-walkthrough.md) —— 中文学习指南：以这个仓库为案例讲清楚长任务 harness 的设计动因，以及这些设计落在了哪些文件里
- [`CLAUDE.md`](CLAUDE.md) —— 给 AI 协作者的仓库指南

---

## 11. License

MIT.
