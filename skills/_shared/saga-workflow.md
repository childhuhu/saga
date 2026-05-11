# Saga shared workflow

All saga skills follow this workflow. Domain-specific Q1/Q2 and delivery
format live in each SKILL.md; this file is the universal procedure.

## Steps

### 1. Clarify (when clarificationRounds > 0)

Ask the Q1 and Q2 from your SKILL.md before calling `saga_start`.
Do not self-decide — always confirm with the user. If the user's
request is already specific enough, proceed to step 2.

### 2. Start the saga

Call `saga_start` with:
- `profile: "<your-profile-id>"`
- `goal`: the user's full request including clarification answers —
  do not summarize or shorten

### 3. Present the plan before executing

When `saga_start` returns `plan_required`, this is a **mandatory two-step sequence**:

**Step 3a — print the plan first (text output, no tool call):**
```
📋 计划（共 N 个阶段）：
1. [Stage title] — [one-line goal]
2. [Stage title] — [one-line goal]
...
```

**Step 3b — then call `saga_advance(sagaId=..., planYaml=<plan>)`.**

Never call `saga_advance(planYaml=...)` before printing the plan. The
user must see the stage list before execution begins.

### 4. Report progress at each stage

After each `saga_advance(workerFinished=true)` returns, post a one-line
update before starting the next stage:

```
✅ Stage N/M 完成：[title]
▶ 开始 Stage N+1：[next title]…
```

### 5. Deliver results

On `completed`, present the substantive content from the artifact
**directly in the conversation** — do not only mention the path.

### 6. Handle failures

On `worker_unrecoverable`, explain what failed, why it matters, and the
next action. Use ⛔ marker.
