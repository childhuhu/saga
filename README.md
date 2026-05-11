# Saga — Long-Running Task Harness for OpenClaw

> A skill-routed harness that turns multi-stage work into a continue-site coordinator with cascading recovery, checkpointable state, and a data-driven evaluator. Zero core modifications to OpenClaw.

English · [中文](README.zh.md)

---

## Table of contents

1. [Why Saga](#1-why-saga)
2. [Eight long-task failure modes Saga addresses](#2-eight-long-task-failure-modes-saga-addresses)
3. [Key features](#3-key-features)
4. [How it fits together](#4-how-it-fits-together)
5. [Install](#5-install)
6. [One saga, end to end](#6-one-saga-end-to-end)
7. [Using Saga](#7-using-saga)
8. [Tools](#8-tools)
9. [Bundled profiles](#9-bundled-profiles)
10. [On-disk layout](#10-on-disk-layout)
11. [Documentation](#11-documentation)
12. [License](#12-license)

---

## 1. Why Saga

Long-task delivery quality is bounded not by model capability but by the surrounding harness — context management, phase structure, validation loops, and recovery mechanisms. Saga is that harness, packaged as a zero-modification OpenClaw plugin: planner → worker-as-injection → hard checks → optional deep evaluator → cascading recovery, with state-of-truth on disk instead of in chat history. Simple tasks that don't need multi-session support are entirely unaffected. The same runtime serves ops, research, curation, review, and any other domain a declarative profile can describe.

---

## 2. Eight long-task failure modes Saga addresses

Short tasks are where LLMs typically perform well. Across hours and multiple sessions, eight failure modes recur reliably. Saga has a specific countermeasure for each.

| # | Failure mode | Description | Saga's countermeasure |
|---|---|---|---|
| 1 | **One-shot illusion** | The model tries to complete the entire task in a single run, producing superficially complete but shallow output. | The planner parses the goal into discrete stages with explicit done-criteria (loose YAML stage-spec); the worker is given only the current stage's goal and required artifacts via the `workerContext` injection. |
| 2 | **Premature completion** | The model decides "good enough" and declares the task done before it is. | Hard checks (file-exists, file-size-gt, free-form) run on each stage's submitted artifacts before any LLM judgement. If they fail, the stage cannot advance. |
| 3 | **Context drift / anxiety** | As the context window fills, the model rushes, skips verification, or hallucinates. | A microcompact-retry recovery layer collapses old eval output into a 200-char compact summary; cascading recovery re-injects the worker with a fresh, focused prompt rather than letting the existing context grow. |
| 4 | **Self-evaluation distortion** | A model evaluating its own output produces inflated scores. | The deep evaluator runs in a separate turn with its own data-driven prompt (H1/H2/H3 hard checklist + S1–S4 soft rubric, rendered from the profile JSON) and a structured JSON verdict, not a free-form judgement. |
| 5 | **Unrecoverable environment** | Interruption leaves the task in a state with no way to resume cleanly. | All state lives on disk under `runs/<sagaId>/`. `resumeSaga` reads `state.json` (or replays `events.jsonl` if `state.json` is gone) and dispatches into the same `advance()` loop — no chat-history dependency. |
| 6 | **Unstructured handoff** | The next agent cannot tell what was done, what remains, and what counts as done. | Each stage carries its own typed `doneCriteria` array; the worker submits its output via `artifacts: [{path, content}]` so the evaluator sees the exact same bytes as the next worker turn. |
| 7 | **Weak external validation** | Quality claims rest entirely on LLM self-assessment with no machine-checkable evidence. | Done-criteria with machine-checkable kinds (`file-exists`, `file-size-gt`, `command`, `file-schema`, `progress-items`, `browser`, `log-scan`, `metrics`) run as hard checks before any deep evaluation. `free-form` is the only kind deferred to the LLM. |
| 8 | **Poor task-level observability** | There is no durable record of what happened, in what order, and why. | An append-only `events.jsonl` captures every state-changing operation: `saga_created`, `plan_produced`, `worker_mode_queued`, `eval_completed`, `recovery_attempt`, `stage_advanced`, `saga_terminated`. |

### Three mechanisms worth a closer look

The table above gives one line per failure mode. Three of those countermeasures are load-bearing in a way that's easy to miss, so they're worth seeing in detail.

**Artifacts pass through a single channel, not the filesystem.** When a worker finishes a stage, it doesn't write files to disk — it calls `saga_advance(workerFinished=true, artifacts=[{path, content}])`. The harness writes those bytes to `runs/<sagaId>/artifacts/<path>` and the evaluator reads from there. There is no path where the worker writes a file and the evaluator can't see it (the failure mode where a model claims it produced output but the bytes never landed). This single-channel design is enforced by the worker-mode injection itself: the prompt explicitly tells the worker "Do NOT use the `write` tool; pass everything through the `artifacts` parameter."

**The deep evaluator gets a structured verdict, not free-form prose.** When `evaluatorMode === 'deep'`, the harness builds a checklist prompt from the profile's JSON: each hard item (H1/H2/H3) gets explicit pass / fail-rework / fail-escalate descriptions, each soft item (S1–S4) gets a 1–5 scoring guide. The agent submits the verdict as `{ passed, score, issues, escalate }`. `escalate: true` is reserved for "the criterion is structurally impossible given available information" — it routes the saga to `awaiting_human` instead of looping in recovery. This distinction (rework-worthy vs. structurally-impossible) is the one most LLM judges flatten away when they're asked to "evaluate this output"; the checklist makes them keep it.

**State persistence is atomic and the event log can rebuild state from scratch.** Every state change writes the *whole* `state.json` to a `.tmp` file and renames it on top of the previous one. There are no patches, no diffs, no concurrent writers — either the new state is fully on disk or the old one is still intact. If `state.json` is missing entirely (corruption, manual delete), `resumeSaga` replays `events.jsonl` from the start and reconstructs the same `SagaState`. This is what makes "crash mid-stage, resume tomorrow" actually work without depending on the agent's memory of what it was doing.

---

## 3. Key features

- **Pure skill-routed trigger.** The host LLM picks the right saga skill from the description in each `SKILL.md`; no keyword heuristic, no per-agent hook configuration.
- **Continue-site coordinator.** `coordinator/advance.ts` is the single dispatcher. Each `if` block is a continue-site. Adding a new recovery path = adding a new `if`. No enum, no switch.
- **Loose YAML stage-spec.** The planner emits markdown with embedded YAML; the parser normalises field names and fills missing fields with `free-form` defaults instead of failing.
- **Worker-as-injection.** No second sub-agent. After each stage advance, the next agent turn is injected with a worker-mode block containing the stage goal, required artifact paths, and a per-profile tool hint. The worker submits results via the `artifacts` parameter on `saga_advance`.
- **Cascading recovery.** Per stage: fix-attempt (×2) → microcompact-retry → full-rework → terminal. Each layer is one `Transition` kind and one continue-site.
- **Data-driven deep evaluator.** No per-profile branches in code — `roles/evaluator-deep.ts` renders a single template from the profile JSON's `evaluator.checklist` (`hard: H1/H2/H3`, `soft: S1–S4`) and a few-shot calibration file.
- **Root-cause classifiers.** Failures are inspected for terminal patterns (`source_unavailable`, `model_capability_exceeded`, `network_transient`, `information_unavailable`) and either short-circuit to a terminal reason, route to `awaiting_human`, or fall through to the recovery cascade.
- **Crash-safe resume.** `state.json` is whole-object atomic writes (tmp → rename). If it's missing, `events.jsonl` is sufficient to reconstruct state.
- **Five bundled profiles.** `ops`, `research`, `curation`, `review`, `generic` — each carrying its own evaluator checklist, few-shot calibration, hard-check kind allowlist, and clarification round count.

---

## 4. How it fits together

```
Host agent
   │  (skill-routed: e.g. saga-research, saga-ops)
   ▼
saga_start ──► coordinator/advance.ts (continue-site loop)
                  │
                  ├─ no plan?       → planner (planYaml prompt to the agent)
                  ├─ plan submitted → queue worker-mode injection for stage 0
                  ├─ workerFinished → runHardChecks(stage.doneCriteria)
                  │                     ├─ all passed + evaluatorMode='auto'  → advance cursor
                  │                     ├─ all passed + evaluatorMode='deep'  → buildDeepEvalPrompt → agent submits evalResult
                  │                     └─ failures → classifyHardCheckFailure → cascading recovery
                  ├─ recovery: fix-attempt ×2 → microcompact-retry → full-rework → terminal
                  └─ all stages done → terminate(completed)
                                          │
                                          └─ (ops profile only) append entry to ops-memory
```

All state lives on disk:
```
<stateRoot>/runs/<sagaId>/
  state.json     # current snapshot (atomic writes)
  events.jsonl   # append-only event stream
  artifacts/     # stage outputs submitted via the artifacts param
```

`stateRoot` defaults to `<openclaw-config>/workspace/saga/.saga` (derived from `api.rootDir`), independent of where the plugin tarball is installed.

### Cascading recovery, in detail

When a stage fails (hard check fails, or deep eval returns `passed: false`), Saga doesn't blindly retry. It first asks the root-cause classifier whether to short-circuit:

```
classifyRootCause(verdict, hardCheckResults, workerDiagnostics)
  ├─ matches network-timeout pattern        → retry as fix-attempt
  ├─ urls all 4xx + searched terms tried    → awaiting_human ("information unavailable")
  ├─ matches 403 / 404 / unauthorized       → terminate("source_unavailable")
  ├─ matches "context window exceeded"      → terminate("model_capability_exceeded")
  └─ everything else                        → fall through to recovery layers

recovery layers, indexed by recoveryAttempts[stageId]:
  attempt 0–1 → fix-attempt        (cheapest: inject evaluator issues into next worker turn)
  attempt 2   → microcompact-retry (compact prior eval to 200 chars, re-enter worker mode)
  attempt 3   → full-rework        (reset stage, fresh worker injection from scratch)
  attempt 4+  → terminate("worker_unrecoverable")
```

Each layer corresponds to one `Transition` kind and one continue-site in `coordinator/advance.ts`. The classifier ensures expensive layers only run on problems that retrying can actually fix — a 403 doesn't deserve four rounds of "let me try again."

---

## 5. Install

### From npm (recommended)

```bash
openclaw plugins install openclaw-plugin-saga
openclaw gateway restart
```

Pin a specific version with `--pin`:

```bash
openclaw plugins install openclaw-plugin-saga --pin
```

### From a GitHub release tarball (no npm needed)

```bash
curl -L https://github.com/childhuhu/saga/releases/latest/download/openclaw-plugin-saga.tgz \
  -o /tmp/openclaw-plugin-saga.tgz
openclaw plugins install /tmp/openclaw-plugin-saga.tgz
openclaw gateway restart
```

A specific version (replace `v1.0.0` and the filename version):

```bash
curl -L https://github.com/childhuhu/saga/releases/download/v1.0.0/openclaw-plugin-saga-1.0.0.tgz \
  -o /tmp/openclaw-plugin-saga.tgz
```

### From source (contributors)

```bash
npm install
npm run build
npm test           # 172 unit tests, ~3s
```

`npm test` covers the 20 unit-test files under `test/`. The LLM regression suite lives in its own setup (see [`CONTRIBUTING.md`](CONTRIBUTING.md)) and is not part of the published package or CI.

To produce a local tarball you can install yourself:

```bash
npm pack
openclaw plugins install ./openclaw-plugin-saga-<version>.tgz
openclaw gateway restart
```

### Plugin config (optional)

```json
{
  "stateRoot": "/absolute/path/for/saga/runs"
}
```

If omitted, `stateRoot` defaults to `<openclaw-config>/workspace/saga/.saga` (derived from `api.rootDir`, independent of where the plugin tarball was installed).

---

## 6. One saga, end to end

Below is what a user sees and what the harness does, for a typical research saga.

**User says:** *"调研一下国内主要 LLM 工具厂商的产品定位和差异化。"*

1. **Skill routing.** The host LLM matches `saga-research` (description starts with "Run a multi-stage research saga…"). The skill's instructions tell it to ask `clarificationRounds=2` worth of clarifying questions before calling `saga_start`.

2. **Clarification.** The agent asks Q1 (*"内部资料 / 公开网络 / 两者都用？"*) and Q2 (*"交付形式是什么——自由格式报告、对比表格、executive summary，还是其它？"*). User answers. The agent calls `saga_start(profile="research", goal=<full original request + clarification answers verbatim>)`.

3. **Planner.** `saga_start` returns `{ status: "plan_required", planPrompt: "..." }`. The agent itself generates a markdown plan with embedded YAML — typically 3–5 stages, each with a `done:` block listing required artifacts and an `evaluator: deep` line. The agent prints the plan to the user (📋 + stage list), then calls `saga_advance(sagaId, planYaml=<the plan>)`.

4. **Stage 1 worker mode.** `saga_advance` returns `{ nextAction: "worker_mode_queued", stageId: "stage-01", workerContext: "..." }`. The `workerContext` is a prepared prompt containing the stage goal, required artifact paths, the per-profile tool hint (e.g. *"Use read, web_fetch, web_search to gather sources"*), and a one-line announcement template the agent uses (`▶ Stage 1/4 开始：...`). The agent works the stage, then calls `saga_advance(workerFinished=true, artifacts=[{path: "stages/stage-01-report.md", content: "..."}])`.

5. **Hard checks.** Saga runs `runDoneChecks` against the submitted artifacts: `file-exists` confirms the path is there, `file-size-gt` confirms it's not a stub. If those pass and `evaluatorMode === 'deep'`, Saga returns `{ nextAction: "eval_deep_required", evalPrompt: "<H1/H2/H3 + S1–S4 checklist>" }`.

6. **Deep eval.** The agent (in a fresh turn, no prior worker context bleeding in) reads the checklist and submits `saga_advance(evalResult={ passed, score, issues, escalate })`. Pass → cursor advances; rework-worthy fail → recovery cascade; structurally-impossible → `awaiting_human` with a diagnostic the agent can read to the user.

7. **Stages 2–N.** Same loop. The agent only sees the current stage's worker context — it doesn't have to remember stages 1..N-1, because the harness re-injects the right context each time.

8. **Terminate.** When the last stage passes, the saga's `termination.reason` becomes `completed`. The agent presents the substantive content from `artifacts/` directly in the conversation (✅ + final summary) — not just a path.

The whole flow is observable: `cat <stateRoot>/runs/<sagaId>/events.jsonl` shows every `saga_created → plan_produced → worker_mode_queued → eval_completed → stage_advanced → saga_terminated` step with timestamps. If anything went off the rails, the event log says what.

---

## 7. Using Saga

There are two paths into the harness; both end up in the same `advance()` loop.

### Skill-routed (recommended)

Describe your task naturally to a host agent. If the LLM matches a saga skill from the description (e.g. "调研一下…" → `saga-research`, "WiFi 又掉了" → `saga-ops`), the skill instructs the agent to call `saga_start` with the right profile after asking the skill's Q1/Q2 clarifications. See `skills/_shared/saga-workflow.md` for the universal workflow each skill follows.

### Explicit tool call

Any agent or test harness can call the tools directly:

```
saga_start(profile="research", goal="…")
   → returns { sagaId, status: "plan_required", planPrompt }

saga_advance(sagaId, planYaml="<markdown plan with embedded YAML>")
   → returns { nextAction: "worker_mode_queued", stageId, workerContext, progress }

saga_advance(sagaId, workerFinished=true, artifacts=[{path, content}])
   → if auto evaluator: advances or enters recovery
   → if deep evaluator: returns { nextAction: "eval_deep_required", evalPrompt }

saga_advance(sagaId, evalResult={ passed, score, issues, escalate })
   → advances, enters recovery, or escalates to human
```

The plan format is loose: markdown with `## Stage N: <title>` headings and a `` ```yaml `` block per stage containing a `done:` array (kinds: `file-exists`, `file-size-gt`, `command`, `free-form`, …) and an `evaluator: auto|deep` line.

---

## 8. Tools

Four tools, snake_case names:

| Tool | What it does |
|---|---|
| `saga_start` | Create a saga, run the clarification pass, then return either `plan_required` (the agent generates a plan and resubmits via `saga_advance(planYaml=…)`) or `worker_mode_queued` (stage 0 begins). |
| `saga_advance` | The single recurrent step. Accepts `planYaml`, `artifacts`, `evalResult`, `humanInput`, and `workerDiagnostics`. Returns one of `worker_mode_queued`, `continue_worker_now`, `revision_queued`, `eval_deep_required`, `clarification_needed`, `await_human`, or `terminated`. |
| `saga_status` | Read-only state snapshot: profile, goal, cursor, current stage id, transition kind, termination, recovery attempts, and a one-line progress summary. |
| `saga_cancel` | Stamp a `Termination` with reason `aborted_by_user`. State is preserved on disk for inspection. |

Resume is a property of the state, not a separate tool: any subsequent `saga_advance` reads the persisted `state.json` and dispatches from wherever the saga left off. If `state.json` is missing, `resumeSaga` reconstructs state from `events.jsonl`.

---

## 9. Bundled profiles

| Profile | Domain | Evaluator | Hard-check kinds | Clarification rounds |
|---|---|---|---|---|
| `ops` | Home/personal infra ops (network diagnosis, device config, recurring issues) | deep | `command`, `file-exists`, `free-form` | 2 |
| `research` | Deep research / literature synthesis | deep | `file-exists`, `file-size-gt`, `progress-items`, `free-form` | 2 |
| `curation` | Batch data tasks (classifying, scoring, filtering, structured output) | auto | `file-exists`, `file-size-gt`, `file-schema`, `free-form` | 1 |
| `review` | Independent multi-round review of an artifact | deep | `file-exists`, `free-form` | 1 |
| `generic` | Last-resort fallback for multi-step work | auto | all kinds | 1 |

Each profile ships with:

- A `profiles/<id>-default.json` declaring `evaluator.checklist` (`hard: H1/H2/H3`, `soft: S1–S4` with weights) and a pointer to the few-shot calibration file
- `data/few-shot-rubrics/<id>.md` with worked PASS / FAIL-REWORK / FAIL-ESCALATE examples
- `src/prompts/worker-tools-<id>.md` (per-profile tool hint injected into the worker context)
- `src/prompts/planner-examples-<id>.md` (per-profile planner few-shot)
- `skills/saga-<id>/SKILL.md` with the domain-specific Q1/Q2 and delivery format

### Profile checklists at a glance

The hard checklist is what the deep evaluator (or `auto` fallback) must verify on every stage. Soft items only affect the 1–5 score, not pass/fail.

**`research`** — H1 Citations present (sources identifiable) · H2 Goal addressed with specifics · H3 ≥5 verifiable facts (names/dates/figures). Soft (S1–S4): source diversity 0.3, analytical depth 0.3, actionable conclusions 0.2, clarity 0.2. Delivery: markdown report with `## References` section.

**`ops`** — H1 Diagnosis grounded (every claim backed by a `command` hard-check) · H2 Remediation reversible (every change has a documented revert, or one-way is called out) · H3 Memory write (terminal stage appends to OpenClaw memory). Soft: diagnostic completeness 0.4, risk awareness 0.3, memory entry quality 0.2, clarity 0.1. Delivery: `diagnosis.md` + `runbook.md`. The `appendOpsMemoryEntry` adapter fires on successful completion.

**`curation`** — H1 Schema compliance (every output validates) · H2 Coverage ratio meets declared threshold · H3 Subjective scores calibrated (spot-check ≥3 records). Soft: schema correctness 0.3, score consistency 0.3, coverage 0.2, organization 0.2. Delivery: JSONL/CSV per the declared schema plus a `summary.md` with score distribution.

**`review`** — H1 Findings cite the artifact (quote or precise location) · H2 Severity assigned (blocker/major/minor/nit + one-sentence rationale) · H3 Coverage stated explicitly (what was checked AND what was NOT). Soft: insight depth 0.4, severity calibration 0.2, coverage breadth 0.2, actionability 0.2. Delivery: a single `review.md`. **Read-only by design** — no `command` hard-check is allowed.

**`generic`** — H1 Goal addressed · H2 Self-contained (a reader who didn't see the chat can use the output) · H3 Done-criteria match the original plan (no scope drift). Soft: completeness 0.3, quality 0.3, clarity 0.2, relevance 0.2. Delivery: free-form, declared in the plan.

### Adding a new profile

Adding a profile means adding a `ProfileDefinition` to `src/profiles/index.ts`, a JSON file under `profiles/`, the three matching prompt/rubric files, and a skill directory. `test/profile-config.test.ts` enforces that every profile has all of those — adding a profile without its supporting files fails the test suite with a precise message about what's missing.

---

## 10. On-disk layout

```
<stateRoot>/runs/<sagaId>/
  state.json                        # current snapshot
  events.jsonl                      # append-only event stream
  artifacts/
    <whatever the worker submitted>
    stages/
      stage-01-report.md            # if submitted under this path
      …
```

The `state.json` schema is the `SagaState` type in `src/coordinator/state.ts`. The event types are the `SagaEvent` union in the same file.

---

## 11. Documentation

- [`docs/zh/codebase-walkthrough.md`](docs/zh/codebase-walkthrough.md) — 中文学习指南：以这个仓库为案例讲清楚长任务 harness 为什么这么设计、设计落在了哪些文件里
- [`CLAUDE.md`](CLAUDE.md) — contributor guidance for AI assistants working in this repo

---

## 12. License

MIT.
