# Saga 代码库学习指南

> 本文档把 Saga 当作一个真实案例，讲清楚长任务 harness 为什么需要被设计成现在这样，以及这些设计在代码里分别落在哪里。读完它，你应该同时得到两样东西：一是能在这个仓库里真正开始动手修改；二是能借这个仓库理解长任务 agent harness 的核心思路。

---

## 1. 先把这个仓库看成什么

读这一节时，你只需要先抓住一个判断：**这个仓库真正的主角不是 OpenClaw 插件接口，而是长任务本身。**

第一次看这个仓库，最容易产生的误解是：这不过是一个 OpenClaw 插件，里面塞了些 tools、hooks、skills 和一些 prompt 模板。

如果只带着这个视角往下读，你很快就会困惑：为什么这里会有 continue-site dispatcher、级联恢复、loose YAML stage-spec、数据驱动的 deep evaluator、microcompact、append-only events.jsonl、root-cause 分类器这些看起来比"普通插件"重得多的东西？为什么代码会被分成 `adapters/`、`coordinator/`、`roles/`、`recovery/`、`stage-spec/`、`compaction/`、`storage/` 这些边界清晰的层？

更准确的理解是：**Saga 首先是一套长任务控制系统，其次才是一个插件。**

它要解决的问题不是"怎样让模型这一轮回答得更聪明"，而是"当任务跨越多个上下文窗口、多个阶段，甚至跨会话时，怎样让系统仍然保持清晰、可靠、可恢复、可验证、可审计"。从这个角度看，Saga 更像一个围绕模型搭起来的小型 workflow runtime：模型是工作者，仓库里的大部分代码是在搭建约束、状态、反馈回路和恢复机制。

这也是理解这个仓库的第一把钥匙：**不要把它当成"给 agent 多加几个功能"，而要把它当成"把长任务从聊天行为升级成结构化执行"。**

带着这个视角继续往下读，你后面看到的每个模块都会顺得多。

---

## 2. 为什么长任务不能只靠 prompt

这一节的作用，是把后面所有"看起来很重"的工程结构都变得合理。你会看到：一旦任务真的跨小时、跨上下文、跨会话，很多在短任务里靠 prompt 勉强兜住的问题，就会系统性冒出来。

### 2.1 一次性冲到底：one-shot illusion

模型天然倾向于把用户目标理解成"这一轮就尽量完成"。在简单任务里这往往是优点；在复杂任务里，这会变成灾难。它会在没有明确阶段边界的情况下试图一口气做完太多事情，结果常常是做到一半上下文耗尽，留下一个半成品现场。

Saga 的回应不是再三提醒模型"请分步思考"，而是把"分步"从提示语变成结构：先 planning，再按 stage 一个一个跑，每个 stage 都有自己的 done-criteria、hard check、可选的 deep eval，以及失败时的恢复链路。

### 2.2 做到一半就宣布结束：premature completion

另一个常见问题是：模型看到产出"差不多了"，就倾向于判断完成。

Saga 的做法，是把"完成"从一种模糊感觉变成显式对象：每个 stage 自己声明 `doneCriteria` 数组，里面的机器可裁决类型（`file-exists`、`file-size-gt`、`command`、`file-schema` 等）会作为 hard check 先跑一遍；只有它们都过了，才进入 evaluator。`free-form` 是唯一一种延迟到 evaluator 判断的类型，它的存在恰恰提醒：默认"做完了"这件事不该让模型说了算。

### 2.3 上下文越长越漂：context drift / context anxiety

长任务里上下文不是静态的，而是在不断累积。聊天历史越长，模型越容易出现两种偏差：

- **漂移**：原始目标和当前重点逐渐错位
- **焦虑**：临近上下文极限时，模型倾向于仓促收尾

很多系统会尝试用"压缩历史摘要"继续使用同一个 agent 会话。Saga 采取的策略更直接：当一个 stage 反复失败时，恢复层有专门的 `microcompact-retry`——把过去那一轮 evaluator 的输出压缩成最多 200 个字符的精简摘要，然后清掉旧的 eval 上下文、重建 worker-mode 注入。换句话说，**它不试图保留更多上下文，而是显式地把上下文做小**。

### 2.4 自评失真：self-evaluation distortion

如果让做事的同一个 agent 来评价自己，几乎一定会得到一种非常熟悉的结果：它能看到问题，但仍然倾向于认为整体"其实还不错"。

于是 Saga 把生成与评估明确拆开。`auto` evaluator 不让 LLM 判断，直接根据 doneCriteria 跑机器检查；`deep` evaluator 在独立的一轮里运行，由 profile JSON 的 checklist 渲染出固定模板（H1/H2/H3 硬项 + S1–S4 软项），强制输出结构化 JSON verdict，而不是自由发挥。

### 2.5 不可恢复：unrecoverable environment

一旦任务跨 session，系统最怕的不是中断本身，而是中断之后没有足够清晰的现场信息。靠聊天历史去恢复任务，会遇到两个问题：

- 历史太长，读不完
- 历史太噪，读了也未必能抓住关键状态

Saga 的恢复思路是：真正需要被交接的，不是整段对话，而是**结构化状态**。所有状态写在 `runs/<sagaId>/` 下的 `state.json` 和 `events.jsonl`。`resumeSaga` 优先读 `state.json`，读不到就从 `events.jsonl` 重建。整个恢复路径不依赖聊天历史。

### 2.6 缺少外部验证：weak external validation

如果一个系统最后只能得到"模型觉得自己做得不错"，那它在长任务里几乎一定会出问题。因为任务越长，局部判断越多，偏差会层层叠加。

Saga 把低歧义问题先交给外部验证：`command`、`file-exists`、`file-size-gt`、`file-schema`、`progress-items`、`browser`、`log-scan`、`metrics`。这些 hard check 先把明显不合格的结果拦下来；只有这些底线过了，才值得进入 deep evaluator 这样的主观评估层。

### 2.7 不可观测：poor observability

短任务里，人还可以靠记忆追踪"刚才发生了什么"。长任务一旦持续几小时，靠记忆和聊天滚动条已经不够用了。

所以 Saga 的事件流是系统的一部分，而不是调试附属物：每一次状态变更都写入 append-only 的 `events.jsonl`——`saga_created`、`plan_produced`、`worker_mode_queued`、`worker_finished`、`eval_completed`、`eval_deep_required`、`deep_eval_completed`、`recovery_attempt`、`stage_advanced`、`saga_terminated`。事后看一条 saga 究竟发生过什么，看这个文件就够。

到这里，你会开始看到：仓库里的很多"重型设计"，其实都不是为了炫技，而是在逐个回应长任务的这些失败模式。

---

## 3. Saga 用哪些稳定结构把长任务固定住

如果说上一节讲的是"长任务会怎么失控"，这一节讲的就是"系统靠什么把它固定住"。这一节也很关键，因为它会把后面零散的代码文件，先统一成几种更容易记住的结构角色。

长任务之所以难，不只是因为它长，更因为很多原本在短任务里被隐含处理掉的东西，一旦任务跨上下文、跨阶段、跨会话，就必须被**显式化**。Saga 的核心设计，就是把这些东西从聊天里抽出来，变成稳定结构。

### 3.1 SagaState：长任务的总账本

`src/coordinator/state.ts` 里的 `SagaState` 是整个系统的总账本。它不是一个简单的任务 ID，而是长任务整体状态的唯一归属点：

```ts
export interface SagaState {
  sagaId: string;
  profile: ProfileId;
  goal: string;
  plan: Plan | undefined;
  stages: Stage[];
  cursor: number;
  modeRevision: number;

  transition: Transition | undefined;
  recoveryAttempts: RecoveryAttempts;

  compactedEvalIds: string[];

  clarificationRound: number;
  clarificationHistory: Array<{ question: string; answer: string }>;
  clarificationLimit: number;

  termination: Termination | undefined;
}
```

很多系统的问题恰恰出在这里：任务状态散落在多个地方——一点在聊天历史里，一点在工具返回里，一点在临时文件里。任务一旦暂停、恢复，就很难回答"现在到底以谁为准"。

Saga 选择显式建模 `SagaState`，就是提前把这个问题消掉：凡是属于"整个长任务"的状态，都挂在它上面。`writeState` 是整对象原子写（tmp 文件 → rename），任何一次写入都是一次完整快照，不存在补丁拼图。

### 3.2 Stage：把一个长任务切成可评估、可返工的单元

长任务不能靠一个巨大的"doing"状态来描述。原因很简单：不同局部工作会有不同的完成标准、不同的返工情况。所以 Saga 引入了 `Stage` 这一层：

```ts
export interface Stage {
  id: string;
  title: string;
  goal: string;
  doneCriteria: DoneCriterion[];
  evaluatorMode: EvaluatorMode;   // 'auto' | 'deep'
}
```

每个 stage 自带：

- 该 stage 的目标（goal）
- 一组 done-criteria（决定 hard check 和后续 deep eval 的依据）
- 一个 evaluator 模式（机器自动判定 vs 让 LLM 走 checklist）

这意味着：返工不需要重新理解整个任务，只需要重新满足当前 stage 的 `doneCriteria`。这让长任务从模糊迭代变成了可收敛迭代。

### 3.3 Transition：一种比"状态枚举"更好的进度表达

Saga 没有用传统的"`status: 'planning' | 'running' | 'evaluating' | 'blocked'`"枚举。它用一个判别联合：

```ts
export type Transition =
  | { kind: 'plan_required' }
  | { kind: 'awaiting_plan_yaml' }
  | { kind: 'worker_mode_injected'; stageId: string }
  | { kind: 'eval_deep_pending'; stageId: string }
  | { kind: 'eval_passed'; stageId: string }
  | { kind: 'eval_needs_fix_attempt'; stageId: string; attempt: number; issues: string[] }
  | { kind: 'microcompact_retry'; stageId: string; issues: string[] }
  | { kind: 'rework_full'; stageId: string; attempt: number; issues: string[] }
  | { kind: 'awaiting_human'; reason: string }
  | { kind: 'clarifying_requirements'; questions: string[] };
```

这个设计很重要，因为它表达的不是"现在处于哪种状态"，而是"**下一步需要在哪里继续**"。例如 `eval_needs_fix_attempt` 既说"现在被打回了"，也带上了`attempt` 和 `issues`——这些是恢复时直接要用的信息。`microcompact_retry` 不需要解释自己"应该做什么"——它的 kind 就是答案。

这一点呼应到 §4 会讲的 continue-site 模式：dispatcher 就是按这些 kind 一个个 if 下来的。

### 3.4 Termination：失败也是一等公民

Saga 没有"blocked"这种暧昧状态。任务要么在跑，要么被 `Termination` 盖戳：

```ts
export type TerminationReason =
  | 'completed' | 'aborted_by_user' | 'plan_rejected'
  | 'worker_unrecoverable' | 'source_unavailable' | 'model_capability_exceeded'
  | 'budget_exceeded' | 'external_check_failed' | 'human_input_required' | 'internal_error';
```

为什么没有"blocked"？因为"被阻塞"本质上是两种东西：

- 需要人来决定 → 用 `awaiting_human` transition（任务还活着）
- 系统判断这条路走不通 → 直接 terminate，原因写清楚

把"被阻塞"拆成这两种之后，恢复策略才有清晰的分支。

### 3.5 DoneCriterion：把"完成"从感觉变成可验证

`DoneCriterion` 是 stage 内"完成"的最小可验证单元：

```ts
export interface DoneCriterion {
  kind: string;
  [key: string]: unknown;
}
```

实际允许的 kind 在 `src/stage-spec/hard-check-kinds.ts` 里：`command`、`file-exists`、`file-schema`、`file-size-gt`、`progress-items`、`browser`、`log-scan`、`metrics`、`free-form`。前八种是机器可判定的；`free-form` 只能交给 deep evaluator。

这里有一个很关键的设计取向：**默认拒绝"完成"是一种主观判断**。如果一个 stage 没有任何机器可裁决的 doneCriteria，至少要有 `free-form` 让 evaluator 来打分。完全不评估的 stage 在 Saga 里是不允许的。

### 3.6 Artifact / state.json / events.jsonl：状态全部外显

恢复能力不是来自"模型记性更好"，而是来自"系统把值得记住的东西留下来了"。Saga 把每个 saga 的状态都拆成三类：

- `state.json` —— 当前快照，每次都整对象写
- `events.jsonl` —— 时间流，append-only，结构化
- `artifacts/` —— 语义产物（worker 提交的内容）

`writeState` 用 tmp → rename 保证原子性。`events.jsonl` 永远只追加。Artifact 由 worker 通过 `saga_advance(artifacts=[{path,content}])` 提交——非常重要的一点是：**worker 不能直接写文件系统**。它只能通过 artifacts 参数把内容交给 harness，再由 `writeArtifact` 写到磁盘。这样 evaluator 看到的就是 worker 提交的同一段字节，不存在"路径里写了但 evaluator 找不到"的歧义。

这和普通聊天系统最大的差别就在这里——Saga 把"记忆"从对话历史中抽出来，变成了文件系统中的显式、可校验、可重建的状态。

---

## 4. Continue-site 模式：为什么 advance() 是一长串 if

看到 `src/coordinator/advance.ts` 几百行、十几个 `if state.transition?.kind === ...` 的时候，第一反应往往是"这能不能拆成状态机？"答案是：拆了反而会更糟。

### 4.1 Continue-site 是什么

每个 `if` 块就是一个"continue-site"——dispatcher 在那里观察 `state.transition` 的 kind，决定这一轮做什么、然后返回。**主循环不在内存里反复 tick，而是每次外部调用 `saga_advance` 推进一格**。

这个模式有几个直接收益：

- 新增一种恢复路径 = 新增一个 `if` 块，不需要改状态机
- 每一种状态走到的逻辑都在它对应的 `if` 里，读源码时不需要在 switch 的 case 之间跳
- 状态机本身就是 Transition 联合类型——TS 编译器会强制你处理新增的 kind

### 4.2 主流程概览

`advance()` 的逻辑顺序，从上到下大致是：

```
continue-site 0  : 澄清阶段（clarificationLimit > 0 且还没 plan 时）
continue-site 1  : 没 plan → 调 planner 或要求 agent 提交 planYaml
continue-site 1b : plan 在但还没启动 → 把第一个 stage 注入 worker
continue-site 2  : workerFinished → 跑 hard checks → 走 auto/deep 评估
continue-site 2b : 收到 deep eval verdict → 推进 / 进入恢复 / 升人
continue-site 3  : eval_needs_fix_attempt → 返回 revision_queued
continue-site 3b : microcompact_retry → 重新注入 worker
continue-site 3c : rework_full → 重新注入 worker
continue-site 4  : awaiting_human → 等待 humanInput
default          : worker_mode_injected → continue_worker_now
```

每个 continue-site 都做三件事：

1. 读必要的状态
2. 决定下一步动作（可能改 transition、写 state、追加 event）
3. 返回一个 `AdvanceResult`（含 nextAction 给 agent 用）

### 4.3 为什么不用 switch

如果用 switch，每加一种 transition kind，就要在所有 case 之间穿插改动；如果用 enum + 大状态机，状态合法性检查和具体行为会混在一起。Saga 选择了一种更分散但更可读的写法：

- **状态的合法性** 由 Transition 联合 + TypeScript 静态检查保证
- **状态对应的行为** 由 advance() 里对应的 `if` 块负责

新加一种恢复策略，只要在 Transition 里加一种 kind，再在 advance() 里加一个 `if` 块。这是一种"边界静态可检查、行为线性可读"的折中。

---

## 5. 为什么代码库这样分层

理解完稳定结构和主流程之后，再看分层就容易得多。

```
┌──────────────────────────────────────────────┐
│  src/adapters/                                │  ← 唯一接触 OpenClaw SDK 的地方
│    openclaw-plugin.ts, tool-registrar.ts,     │
│    hook-registrar.ts, ops-memory.ts           │
├──────────────────────────────────────────────┤
│  src/coordinator/   ← 主调度                  │
│  src/roles/         ← planner / evaluator     │
│  src/recovery/      ← 级联恢复 + 分类器       │
│  src/stage-spec/    ← 解析 + done-criteria    │
│  src/compaction/    ← microcompact / prefix   │
│  src/profiles/      ← 五个 profile 的定义     │
│  src/prompts/       ← 模板 + per-profile 片段  │
│  src/storage/       ← state / events / artifacts│
└──────────────────────────────────────────────┘
```

### 5.1 `adapters/`：唯一接触 OpenClaw 的地方

整个仓库里只有 `src/adapters/openclaw-plugin.ts` 知道 OpenClaw SDK 长什么样。它做四件事：

- 提供 `createSagaPlugin()` 工厂——供测试和 CLI 装配 deps
- 默认导出 `register(api)`——gateway 加载插件时调用
- 把 deps 里那一组 reader/writer 接到真实存储
- 把 `coordinator` 里的工具函数包装成 OpenClaw 工具（`saga_start`、`saga_advance` 等）

其余所有模块（`coordinator`、`roles`、`recovery`、`stage-spec`、`compaction`、`profiles`、`prompts`、`storage`）都**不知道 OpenClaw 存在**。它们只依赖纯函数接口（`AdvanceDeps`）。

这套约束最直接的收益是：

1. 单元测试可以直接 mock 出 `AdvanceDeps`，跑完整的 advance() 而不需要 gateway
2. 控制逻辑变化不会牵动适配层，反过来也成立

### 5.2 `coordinator/`：把所有状态变化收口在一处

`coordinator/state.ts` 定义全部类型；`coordinator/advance.ts` 是唯一的 dispatcher；`coordinator/transitions.ts` 是 transition 的纯函数辅助。`coordinator/progress.ts` 负责把 SagaState 投影成一行人类可读摘要（`buildProgressSummary` 返回 `{ display, cursor, total, stageTitle }`）。

注意一点：所有状态变化都从 `advance()` 里发出。没有"某个工具偷偷改 state"这种事——这是一致性的源头。

### 5.3 `roles/`、`stage-spec/`、`recovery/`、`compaction/`：每一个目录解决一个具体问题

这四个目录可以按"它们守护什么"来记忆：

- `roles/` —— 守护"谁来生成、谁来评估"
- `stage-spec/` —— 守护"什么算完成"
- `recovery/` —— 守护"失败之后怎么办"
- `compaction/` —— 守护"上下文压力下还能继续往前"

第 §6 会逐个展开。

### 5.4 `profiles/` + `prompts/` + `data/few-shot-rubrics/`：把领域差异从 runtime 中抽出去

这三个目录是 Saga 处理"领域差异"的方式。每个 profile 都不在代码里写分支，而是写一份 JSON（在 `profiles/`）、一份 prompt 片段（在 `src/prompts/`）、一份 few-shot 校准（在 `data/few-shot-rubrics/`）。

`src/profiles/index.ts` 里的 `ProfileDefinition` 是 TS 一侧的最小注册条目（label、defaultEvaluatorMode、allowedHardCheckKinds、recommendedStageCount、defaultClarificationRounds）；其它信息都从 JSON 加载。

这种安排保证：新加一个 profile，几乎不需要碰 runtime 代码。

### 5.5 `storage/`：按数据语义而不是按"存东西"分

`storage/` 下没有一个万能 store。原因是 Saga 把不同种类的持久化责任拆开了：

- `state-store.ts` —— 当前快照（整对象写）
- `events.ts` —— append-only 时间流
- `artifact-store.ts` —— 语义产物（worker 提交的内容）
- `diagnostic-store.ts` —— 根因诊断（recovery 用）

这种分法让"恢复"和"审计"用对的东西。例如：恢复时优先读 state.json，丢了再重放 events.jsonl；事后审计直接看 events.jsonl。

---

## 6. 关键模块分别在解决什么问题

到这里就不该再把仓库里的文件看成"目录树上的节点"，而应该把它们看成一组**设计响应**：每个模块都在替长任务系统守住某种稳定性。

### 6.1 `src/coordinator/state.ts`：守住"状态形状"

它定义全部类型：`SagaState`、`Stage`、`Transition`、`Termination`、`AdvanceDeps`、`AdvanceResult`、`SagaEvent`。整个仓库里其它模块共享的"世界模型"都在这里。

注意一个小细节：所有可选字段都用 `undefined`（不是 `?:`），让 JSON 序列化、补水（hydration）、原子写之间没有"字段不存在 vs 字段为 undefined"的歧义。状态机的合法性进一步交给 TS 编译器静态检查——`Transition` 是判别联合，每次新增 kind 都会让 `advance()` 里没处理的分支报警。

### 6.2 `src/coordinator/advance.ts`：守住主流程的一致性

如同 §4 讲的，这是唯一的 dispatcher。它做的几个关键决定值得反复看：

- **澄清阶段** (continue-site 0)：当 `clarificationLimit > 0` 且 plan 还没出现时，会调用 `deps.runClarifier`。如果用户说"够了"或者 Clarifier 主动说 skip，就跳过；否则把 questions 写进 transition，把控制权交还 agent。
- **Planner 阶段** (continue-site 1)：调用 `deps.runPlanner`。注意工具上下文里**不能 spawn sub-agent**（会触发 `RequestScopedSubagentRuntimeError`），所以默认 `runPlanner` 直接返回空 plan，引导 agent 自己生成 planYaml，然后通过 `saga_advance` 提交。
- **Worker finished** (continue-site 2)：先跑 hard checks。全部通过 → 看是 auto 还是 deep；有失败 → 先让 `classifyHardCheckFailure` 看是不是终结失败（如 `source_unavailable`），不是的话进入恢复级联。
- **Deep eval verdict** (continue-site 2b)：根据 evaluator 返回的 verdict 决定推进、进入恢复、还是 escalate 到人。
- **恢复链路** (continue-site 3 / 3b / 3c)：根据 transition kind 重新注入 worker 或返回 revision_queued。

如果你以后要加一种新的恢复策略、新的中间态、新的等待人类的方式，都是在这里加 `if` 块。

### 6.3 `src/coordinator/transitions.ts`：守住"状态变化是纯函数"

只有几个小函数：`terminate(reason, details)`、`advanceCursor(state, stageId)`、`applyPlan(state, plan)`、`bumpRecovery(state, stageId)`。它们都接受旧 state、返回新 state，没有任何 I/O。

为什么单独抽一个文件？因为 advance() 里多处会调用这些，能集中表达"状态推进"这一类操作。也方便单测——`test/happy-path.test.ts`、`test/resume-scenarios.test.ts` 都直接调它们。

### 6.4 `src/coordinator/progress.ts`：把状态投影成一行人话

它就是 `buildProgressSummary(state)`——把 SagaState 投影成一个供前端显示的简洁对象（`display` 是一行字符串，`cursor` / `total` / `stageTitle` 是结构化的）。adapter 把它发到 OpenClaw 的 system event 通道，让 UI 实时看到进展。

这件事看起来小，但很重要：长任务里"用户不知道现在在做什么"是真实的焦虑来源。

### 6.5 `src/stage-spec/parser.ts` 和 `done-criteria.ts`：守住"loose 但显式"

`parser.ts` 是 stage spec 的宽松解析器。它接受 planner 输出里的 YAML 字典（其实是 markdown 嵌入的 YAML），做几件事：

- 规范化字段名（`done` / `dod` / `acceptance` 都映射到 `doneCriteria`）
- 补齐缺失字段（缺 id 自动生成 `stage-NN`、缺 evaluator 用 profile 默认）
- 不报错，而是把问题记到 `missingFields`，让 planner 在下一轮按需修正

`done-criteria.ts` 则负责拿到 stage 后实际跑 hard check：

- `file-exists` / `file-size-gt` —— 真去 fs 读
- `free-form` —— 永远通过（交给 deep evaluator）
- 其他 kind —— soft pass（当前没全部实现，留给后续）

这两个文件合起来体现的就是 §3.5 提的那条原则：**显式声明"完成"，但不让 worker 因为格式小错就停下来**。

### 6.6 `src/stage-spec/hard-check-kinds.ts`：把 kind 的特性提到类型层

很短的一个文件，定义了 `HARD_CHECK_TRAITS`——每种 kind 是否只读、是否并发安全。`partitionChecks` 用它把一组 criteria 切成"可并发的只读批"和"必须串行的写批"。

这个抽象现在还没被全量利用（实际执行还是顺序的），但它表达了一种意图：当未来真要并发时，所有 kind 的特性已经在一处声明清楚了。

### 6.7 `src/roles/planner.ts`：守住"planner 出错也能往前"

它做两件事：

1. `parsePlannerOutput(rawOutput)` —— 把 markdown 配 YAML 的 planner 输出，拆成一组 Stage
2. `buildPlannerFeedback(missingFields)` —— 当 planner 漏字段时，构造一段给下一轮的反馈

注意它不是严格 JSON Schema 校验。它的目标是：**只要能从 planner 输出里榨出 stage，就生成 stage；榨不出的字段用 free-form 兜底**。这条原则呼应到 §6.5——长任务系统不能因为一个格式问题整体停摆。

### 6.8 `src/roles/evaluator-deep.ts`：数据驱动的 checklist

这是一个很关键的设计。整个文件里**没有任何 per-profile 分支**。它接受 `DeepEvalInput`，从 `profile.evaluator.checklist` 渲染 H1/H2/H3 硬项和 S1/S2/S3/S4 软项，加上 few-shot 校准，构造一段 prompt 让 agent 提交结构化 JSON verdict。

`parseDeepEvalVerdict(raw)` 反过来解析 agent 返回的 JSON。如果格式不对，回退为"未通过 + 'output not valid JSON'"，不抛异常。

这个文件最重要的暗含约定是：**所有领域差异都在 profile JSON 里**。要改一种 profile 的评估逻辑，去改 `profiles/<id>-default.json` 的 checklist，而不是改这个文件。

### 6.9 `src/recovery/cascading-chain.ts`：守住"失败也有梯度"

这是恢复级联的全部逻辑。它根据 `state.recoveryAttempts[stageId]` 的次数决定该走哪一层：

- attempts 0–1 → `fix-attempt`（最便宜：把 evaluator issues 注入下一轮 worker）
- attempts 2 → `microcompact-retry`（清旧 eval 上下文，重新注入）
- attempts 3 → `full-rework`（更激进，stage 等于重启）
- attempts ≥ MAX_RECOVERY_ATTEMPTS（4） → `terminal`

`applyRecovery(state, decision)` 把决定应用到 state——它会把 transition 改成对应的 kind，attempts 自增。

这种分层很像成熟工程系统里的故障分级：不是所有问题都值得同一种恢复策略。

### 6.10 `src/recovery/classifiers.ts`：决定何时早早放弃

很多时候应该**不进入恢复级联**，因为问题不是"再试一次能解决"那种。这个文件就是判别器：

- `classifyHardCheckFailure` —— 在 hard check 失败里找 403/404/unauthorized/rate limit 模式，发现就转为 `source_unavailable` 终结
- `classifyEvalFailure` —— 在 evaluator 失败里找"context window exceed / token limit"模式，发现就转为 `model_capability_exceeded` 终结
- `classifyRootCause` —— 综合 verdict / hard check / worker diagnostics，决定是 `network_transient`（重试）、`information_unavailable`（升人）还是 `quality_insufficient`（继续恢复）

这个模块体现的是另一种工程取舍：**好的恢复系统不只是会重试，更会判断"什么时候不该重试"**。

### 6.11 `src/compaction/microcompact.ts`：把上下文做小，不是做大

非常短的一个文件。`microcompactEval(full, stageId)` 接受一份完整的 eval 输出，产出 `{ verdict, score, summary (≤200 chars), pointer }`。`isAlreadyCompacted` 检查一份数据是不是已经被压缩过。

它的作用是配合 §6.9 的 microcompact-retry 层：当一个 stage 卡住时，下一个 worker 不需要看完整的 eval JSON，只需要看一句摘要 + 一个指针。

这个模块呼应到 §2.3：**真正抗 context pressure 的方法不是"压缩历史然后继续"，而是"把不必要的细节扔掉，再继续"**。

### 6.12 `src/compaction/prefix-builder.ts` 和 `context-collapse.ts`：渐进式 worker context

`prefix-builder.ts` 负责构造 worker mode 的稳定前缀——saga goal、当前 stage、required artifacts。`context-collapse.ts` 用于在多次返工后塌缩多余的旧 eval 注入。

两者合起来支撑一件事：每次给 worker 注入的 prompt，结构都是稳定的，只有内容（issues、context revision）变化。这让 worker 的上下文不会随着返工次数累积爆炸。

### 6.13 `src/profiles/index.ts` 和 `checklist-schema.ts`：把领域差异收口

`index.ts` 是五个 profile 的 TS 注册条目——每个有 `label`、`defaultEvaluatorMode`、`allowedHardCheckKinds`、`recommendedStageCount`、`defaultClarificationRounds`。它故意保持非常小，是因为 profile 的"真正个性"都在 JSON 里。

`checklist-schema.ts` 是用 zod 定义的 `EvalChecklist`——把 `profiles/<id>-default.json` 的 `evaluator.checklist` 字段在运行时验证一遍。这一层是 §6.8 数据驱动 deep evaluator 的保险绳：JSON 改坏了会在加载时报错，而不是渲染时炸 prompt。

### 6.14 `src/prompts/index.ts` 和 prompt 文件：per-profile 但不分叉

`index.ts` 提供两个 loader：`loadPlannerPrompt(profile)`（拼 `planner.md` + `planner-examples-<profile>.md`）和 `loadWorkerTools(profile)`（读 `worker-tools-<profile>.md`）。

这个安排让每个 profile 都能告诉 worker"你这一类任务该用什么工具"，但底层的 worker 流程（如何 announce、如何提交 artifacts、何时停）在 `worker-mode-injection.md` 里统一表达。

`prompts/` 下还有几个 `.md.tpl`（`bootstrap-ritual.md.tpl`、`contract-proposal.md.tpl`、`contract-review.md.tpl`、`evaluator-intro.md.tpl`、`planner-intro.md.tpl`、`worker-intro.md.tpl`）——这些是部分被使用的模板片段，遵循"模板放磁盘、由 builder 注入数据"的同一模式。

### 6.15 `src/storage/state-store.ts`：原子写 + 路径辅助

它定义了一组路径函数（`runsDir`、`sagaDir`、`statePath`、`eventsPath`、`artifactsDir`），以及 `readState` / `writeState` / `ensureSagaDir`。

`writeState` 的实现很经典：写 tmp 文件 → rename。读取出问题时抛 `StateCorruptedError`（带 sagaId 上下文）。这两件事合起来保证：**任何一次状态写入，要么完整出现在磁盘上，要么完全不出现，不会有半截**。

### 6.16 `src/storage/events.ts`：append-only 时间流

非常薄。`appendEvent(stateRoot, sagaId, event)` 一行 JSON 追加到 `events.jsonl`；`readEvents` 行行解析回来。

这个文件的价值在它"看起来太简单"——简单到容易被忽视，但它就是 §2.7 解决可观测性问题的全部基础设施。所有事件类型都在 `SagaEvent` 联合里强类型保证。

### 6.17 `src/storage/artifact-store.ts`：worker 出口

`writeArtifact(stateRoot, sagaId, relPath, content)` —— 写到 `runs/<sagaId>/artifacts/<relPath>`，自动建中间目录。`readArtifact`、`artifactExists` 是配套读侧。

这里的关键设计在 §3.6 已经讲过：worker 不能直接写文件，只能通过 `saga_advance` 的 `artifacts` 参数提交。`tool-registrar.ts` 里的 `saga_advance` 接到 artifacts 后会调 `writeArtifact` 写盘。这条单向通道保证 evaluator 永远看到的就是 worker 提交的同一段字节。

### 6.18 `src/storage/diagnostic-store.ts`：恢复用的"现场快照"

`writeDiagnostic(stateRoot, sagaId, stageId, attempt, diagnostics)` —— worker 在失败时可以通过 `saga_advance(workerDiagnostics={...})` 附带一份 `WorkerDiagnostics`（包含 `searchedTerms`、`urlsAttempted`、`errorsCaught`、`notes`），写到磁盘备查。`readLatestDiagnostic` 在恢复时被 `classifyRootCause` 读取，用来判断到底是"网络超时"还是"信息不存在"。

这个模块是 §6.10 分类器能做得好的前提——分类器需要原始信号，diagnostic-store 就是这些信号的载体。

### 6.19 `src/adapters/openclaw-plugin.ts`：唯一接触宿主的地方

它有几个职责：

- 定义本地 `OpenClawPluginApi` 接口（不导入 SDK，避免编译耦合）
- 提供 `createSagaPlugin(deps?, opts?)`——给测试和 CLI 用
- 默认导出 `register(api)`——OpenClaw gateway 加载时调用，注册工具、hook、session extension
- 把 `coordinator` / `roles` / `stage-spec` / `storage` 里的纯函数组装成 `AdvanceDeps`

它还做了一件值得注意的事：默认 `stateRoot` 是从 `api.rootDir` 派生的 `<openclaw-config>/workspace/saga/.saga`。这个路径**故意不在插件目录内**，目的是用户数据在插件升级/卸载时不会被误删。

### 6.20 `src/adapters/tool-registrar.ts`：薄到几乎没业务

这是四个工具（`saga_start`、`saga_advance`、`saga_status`、`saga_cancel`）的注册器。每个工具的 handler 都很薄：解析参数、调 advance() 或读 state、整理返回值。

一个值得看的细节：`saga_advance` 返回的 `workerContext` 字段是给 agent 直接展示的 worker mode 提示——里面已经把 stageId、stage title、required artifact paths、per-profile 工具提示都拼好了。这意味着 agent 不需要"二次解析"工具返回，就能直接进入工作状态。

### 6.21 `src/adapters/hook-registrar.ts`：上下文注入 + 鉴权

只有两个 hook：

- `before_prompt_build` —— 如果该 session 有活跃 saga 且 transition 表示 worker mode / 恢复 / deep eval，则向 prompt 注入一段 "Saga X 还在进行中..." 的上下文
- `before_tool_call` —— 简单守门：同一 session 不能有两个活跃 saga，`saga_advance` 必须带 sagaId

这两个 hook 都不承担触发逻辑——触发完全由 skill 路由完成，hook 只负责让"已经开始的 saga"在跨轮上下文里不被丢失。

### 6.22 `src/adapters/ops-memory.ts`：仅对 ops profile 追加记忆

很短的一个文件。当一个 ops profile 的 saga 成功完成时，会向 OpenClaw 的活跃 memory 文件追加一条结构化记录（症状、诊断、补救、所触及设备）。下一次类似问题出现时，host agent 可以通过 `memory_search` 找到。

它是唯一一个"把 saga 结果向 OpenClaw 反向写回"的模块——其它 profile 的产物都只留在 `runs/<sagaId>/artifacts/` 下，不影响 OpenClaw 内部状态。

---

## 7. 一次完整执行是怎样流过系统的

把前面散落的知识串起来。

### 7.1 从 skill 路由到 saga_start

用户对 host agent 说"调研一下国内 LLM 工具生态"。host LLM 根据 `skills/saga-research/SKILL.md` 的 description 匹配到 `saga-research`。Skill 指示 agent：

1. 先问 Q1（来源范围）、Q2（交付形式）
2. 等用户回答后，调 `saga_start(profile="research", goal=用户原话 + 澄清答案)`

`saga_start` 的 handler 在 `tool-registrar.ts`，做的事情很简单：

1. 生成 sagaId（`saga-${timestamp}-${random}`）
2. `ensureSagaDir`——建好 `runs/<sagaId>/{state.json, events.jsonl, artifacts/stages/}`
3. `createSaga(sagaId, profile, goal, deps)`——初始化 state，写盘，追加 `saga_created` 事件
4. 调一次 `advance({ sagaId })`——dispatcher 决定接下来做什么

### 7.2 澄清阶段（如果 profile 配置了 > 0 轮）

advance() 第一个 continue-site 看到 `clarificationLimit > 0 && plan === undefined`，调 `deps.runClarifier(state)`。Clarifier 返回一组问题；advance 把它们写进 `transition: { kind: 'clarifying_requirements', questions: [...] }`，返回 `nextAction: 'clarification_needed'`。

agent 这一轮就是把 questions 转述给用户。用户回答后，agent 用 `saga_advance(humanInput="...")` 把答案带回；advance() 看到 humanInput，把答案追加到 `clarificationHistory`，再决定要不要继续问。

### 7.3 Planner 阶段

clarification 结束后，advance() 走到第二个 continue-site：`plan === undefined`。它调 `runPlanner`。默认实现返回空 plan（因为工具上下文里不能 spawn sub-agent），同时返回 `nextAction: 'await_human'` 配一段"请你生成 plan 然后通过 planYaml 提交"的提示。

agent 自己生成 markdown 计划（含嵌入 YAML），调 `saga_advance(planYaml="...")`。advance() 收到 planYaml，调 `parsePlannerOutput` 解析出 Stage 数组，写回 state，追加 `plan_produced` 事件，然后立刻进入下一个 continue-site：**自动把 stage 0 的 worker mode 注入下一轮**。

### 7.4 Worker mode 注入

`queueWorkerAndEmit` 调 `deps.queueWorkerModeInjection(state, stage)`。这个 deps 在 `adapters/openclaw-plugin.ts` 里被实现为：

1. 调 `api.enqueueNextTurnInjection`——往下一轮 agent prompt 前面塞一段 worker mode 文本
2. 调 `api.runtime.system.enqueueSystemEvent`——往 UI 通道推一行进度

工具返回时还附带一个 `workerContext` 字段，agent 也能直接看到。这里有点冗余但故意如此：**重要信息不依赖单一注入路径**。

worker 拿到上下文后，就开始干活——调它需要的工具（read、web_fetch、command 等，per-profile 列出来）、产出内容。完成后调 `saga_advance(workerFinished=true, artifacts=[{path:"stages/stage-01-report.md", content:"..."}])`。

### 7.5 Hard check + evaluator

advance() 看到 `workerFinished=true`，做的第一件事是 `runHardChecks(stage, state)`——把所有 doneCriteria 拿去 `done-criteria.ts` 里跑。

- 全部通过 + `evaluatorMode='auto'` → 调 `runEvaluator`（默认就是再跑一遍 hard checks 当机器评估），通过则 `advanceCursor`
- 全部通过 + `evaluatorMode='deep'` → 调 `buildDeepEvalPrompt(state, stage)`，把 profile JSON 的 checklist 拼成 prompt，返回 `nextAction: 'eval_deep_required'` 让 agent 提交 verdict
- 有失败 → 先看 `classifyHardCheckFailure` 是否分类为终结（如 `source_unavailable`），不是再进入 `handleRecovery`

### 7.6 Deep eval verdict 提交

agent 看到 `eval_deep_required` 和 `evalPrompt`，自己作为 evaluator 在新一轮里输出结构化 JSON verdict，再调 `saga_advance(evalResult={passed,score,issues,escalate})`。advance() 在 continue-site 2b：

- `passed=true` → `advanceAfterPass`
- `escalate=true` → 写 `awaiting_human` transition，返回需要人决策的诊断（"验收标准无法达成"）
- 否则 → `handleRecovery`

### 7.7 恢复级联

`handleRecovery` 先调 `classifyRootCause`——综合 worker diagnostics、hard check 结果、verdict 来判断。如果根因是 `awaiting_human` → 直接挂起等人；如果是 `terminal` → 直接终结。否则才进 `classifyRecovery` 决定具体走哪一层：

- attempt 0–1 → `fix-attempt`：把 issues 写进 transition，下次 advance 时 worker mode 注入会把 issues 段拼进 prompt
- attempt 2 → `microcompact-retry`：触发上下文清理后重新注入 worker
- attempt 3 → `full-rework`：重置 stage 状态，重新注入 worker
- attempt ≥ MAX → terminal

每次恢复都写一条 `recovery_attempt` 事件——事后看一条 saga 总共重试过几次、每次什么原因，一查就清楚。

### 7.8 终结

当所有 stage 都通过时，`advanceAfterPass` 看到 `allStagesDone`，调 `terminateAndPersist(state, sagaId, 'completed', ...)`，写 `state.termination = { reason: 'completed', ... }`，追加 `saga_terminated` 事件。

`adapters/openclaw-plugin.ts` 在工具 handler 里捕获 `nextAction === 'terminated' && reason === 'completed'`，对 ops profile 的 saga 调 `appendOpsMemoryEntry`——把摘要写到 OpenClaw 的 memory 文件，供后续类似问题查找。

---

## 8. 如果你要修改这个仓库，应该从哪里下手

把前面讲的结构和方法论压缩成可执行的改动入口。

### 8.1 想新增一种 hard-check

按这个顺序：

1. `src/stage-spec/hard-check-kinds.ts` —— 加 kind + 它的 `HardCheckTraits`
2. `src/stage-spec/done-criteria.ts` —— 在 `evaluateDoneCriterion` 加一个 case
3. `test/hard-check-kinds.test.ts` —— 静态属性测试
4. 在某个 profile 的 `allowedHardCheckKinds` 里加上（如果只有部分 profile 用）

千万不要先在某个 evaluator 里调起来——这样会绕过 traits 表，未来并发优化时会出问题。

### 8.2 想改状态机

按这个顺序：

1. `src/coordinator/state.ts` —— 修改 `Transition` 联合 / `TerminationReason`
2. `src/coordinator/advance.ts` —— 加对应的 continue-site
3. 跑 `npm run typecheck`——TS 会告诉你哪些地方还没处理新增的 kind
4. 写测试：先单独测 transition 纯函数（`transitions.ts`），再测 advance() 在新状态下的行为

### 8.3 想加 profile

按这个顺序：

1. `src/coordinator/state.ts` —— 把新 id 加进 `ProfileId` 联合
2. `src/profiles/index.ts` —— 加 `ProfileDefinition`
3. `profiles/<id>-default.json` —— 含 `evaluator.checklist`（H1/H2/H3 硬 + S1–S4 软）
4. `data/few-shot-rubrics/<id>.md` —— 至少 3 个 worked example，其中一个演示 escalate
5. `src/prompts/worker-tools-<id>.md` —— per-profile 工具提示
6. `src/prompts/planner-examples-<id>.md` —— per-profile planner few-shot
7. `skills/saga-<id>/SKILL.md` —— 跟 `_shared/saga-workflow.md` 一致的工作流
8. `test/profile-config.test.ts` 应该会自动验证它们都齐全——如果失败说明少了某个文件

### 8.4 想加一种恢复策略

按这个顺序：

1. `src/coordinator/state.ts` —— 加一种 `Transition` kind
2. `src/recovery/cascading-chain.ts` —— 把新策略放进 `classifyRecovery` 的合适层级
3. `src/coordinator/advance.ts` —— 加 continue-site 处理新的 transition kind
4. 写测试覆盖三种走法：第一次进入、第二次升级、第三次降级到 terminal

### 8.5 想接入新的宿主能力（如新的事件通道）

按这个顺序：

1. 在 `src/coordinator/state.ts` 的 `AdvanceDeps` 加抽象 method
2. 在 `src/adapters/openclaw-plugin.ts` 里实现这个 method（**这是唯一允许 import OpenClaw SDK 的地方**）
3. 让 `coordinator/advance.ts` 在合适的 continue-site 调它

记住分层纪律：如果你在 `coordinator/`、`roles/`、`recovery/`、`stage-spec/`、`compaction/`、`storage/` 中的任何一个文件里看到自己想 import OpenClaw SDK，那不是缺代码——那是缺一层抽象。

---

## 9. 能从这个案例里带走哪些 harness 原则

最后这一节，不是离开仓库讲理论，而是把你已经看到的东西抬高一点。

### 9.1 长任务的可靠性首先来自结构，而不是 prompt 机巧

模型当然重要，但一旦任务进入多阶段、多会话、多轮返工，真正决定系统稳定性的往往不是 prompt 多漂亮，而是你是否给任务提供了明确状态、边界、恢复点和反馈回路。Saga 在结构上做到的几件事——continue-site 主循环、loose stage-spec、级联恢复——都是这一点的具体体现。

### 9.2 状态必须显式化

如果关键信息只存在于聊天历史或某个 agent 的"心里"，系统一旦中断就只能靠猜。Saga 用 `SagaState` / `Transition` / `events.jsonl` / `artifacts/` 把这些信息全部外显化，本质上是在把长任务从"对话过程"变成"可恢复流程"。

### 9.3 生成和评估必须结构性分离

让同一个 agent 既做事又给自己打分，几乎注定虚高。Saga 把 hard check 和 deep evaluator 拆开，前者是机器、后者是独立一轮的 LLM 跑 checklist——这种结构上的分离，比任何"请客观评价"prompt 都更稳。

### 9.4 上下文管理的关键是做小，不是做大

继续往一段已经膨胀的上下文里塞更多东西，是常见错误。Saga 的 microcompact、context-collapse、worker-as-injection 都在做同一件事：**让每一轮 agent 只看到必要的东西**。

### 9.5 失败应该有梯度

"做错了就重试一次"是糟糕的恢复策略。Saga 把失败分成 fix-attempt → microcompact-retry → full-rework → terminal，并且用 classifier 把"不该重试的失败"直接终结。这两件事合起来，让系统在长任务里既不轻言放弃，也不无谓重试。

### 9.6 观测性不是附属功能

事件、artifacts、progress summary 不是调试时顺手留下的副产物，而是系统本身维持可靠性所需要的控制面。没有这些，长任务就难以做到可追踪、可复盘、可恢复。

### 9.7 领域差异应该在数据里，不在分支里

Saga 的 deep evaluator 不知道有"research / ops / curation / review / generic"这些 profile——它只知道"读 checklist 然后渲染"。加一种新 profile 不需要改 evaluator 一行代码。这是一种很重要的工程纪律：**runtime 应该尽量稳定，领域变化应该被边界层吸收**。

---

## 10. 最后，回到这个仓库本身

如果把前面的内容都压缩成一句话，可以这样说：

**Saga 不是在教模型"怎样表现得更像一个能做长任务的人"，而是在工程上为它搭出一条真正能支撑长任务的轨道。**

读完这篇 walkthrough，你最重要的收获应该是：

- 你知道这套系统在对抗哪些长任务失败模式
- 你知道这些失败模式分别被哪些结构和模块吸收了
- 你知道主流程如何从 `saga_start` 走到 final termination
- 你知道改动某类能力时应该沿着哪些边界动手

如果你准备继续往源码里钻，最值得重新打开的三个文件是：

- `src/coordinator/state.ts` —— 先理解系统以什么结构保存世界
- `src/coordinator/advance.ts` —— 再理解整条执行链如何被调度
- `src/adapters/openclaw-plugin.ts` —— 最后看这套系统是如何接到真实宿主上的

到这一步，阅读这个仓库的方式就会发生变化：你不再是在读一堆实现细节，而是在读一套围绕长任务可靠性搭起来的控制系统。
