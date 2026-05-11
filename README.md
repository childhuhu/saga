# Saga — Long-Running Task Harness for OpenClaw

> A skill-routed harness that turns multi-stage work into a continue-site coordinator with cascading recovery, checkpointable state, and a data-driven evaluator. Zero core modifications to OpenClaw.

English · [中文](README.zh.md)

---

## Table of contents

1. [Why Saga](#1-why-saga)
2. [Eight long-task failure modes Saga addresses](#2-eight-long-task-failure-modes-saga-addresses)
3. [Key features](#3-key-features)
4. [How it fits together](#4-how-it-fits-together)
5. [Install and build](#5-install-and-build)
6. [Using Saga](#6-using-saga)
7. [Tools](#7-tools)
8. [Bundled profiles](#8-bundled-profiles)
9. [On-disk layout](#9-on-disk-layout)
10. [Documentation](#10-documentation)
11. [License](#11-license)

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

## 6. Using Saga

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

## 7. Tools

Four tools, snake_case names:

| Tool | What it does |
|---|---|
| `saga_start` | Create a saga, run the clarification pass, then return either `plan_required` (the agent generates a plan and resubmits via `saga_advance(planYaml=…)`) or `worker_mode_queued` (stage 0 begins). |
| `saga_advance` | The single recurrent step. Accepts `planYaml`, `artifacts`, `evalResult`, `humanInput`, and `workerDiagnostics`. Returns one of `worker_mode_queued`, `continue_worker_now`, `revision_queued`, `eval_deep_required`, `clarification_needed`, `await_human`, or `terminated`. |
| `saga_status` | Read-only state snapshot: profile, goal, cursor, current stage id, transition kind, termination, recovery attempts, and a one-line progress summary. |
| `saga_cancel` | Stamp a `Termination` with reason `aborted_by_user`. State is preserved on disk for inspection. |

Resume is a property of the state, not a separate tool: any subsequent `saga_advance` reads the persisted `state.json` and dispatches from wherever the saga left off. If `state.json` is missing, `resumeSaga` reconstructs state from `events.jsonl`.

---

## 8. Bundled profiles

| Profile | Domain | Evaluator | Hard-check kinds | Clarification rounds |
|---|---|---|---|---|
| `ops` | Home/personal infra ops (network diagnosis, device config, recurring issues) | deep | `command`, `file-exists`, `free-form` | 2 |
| `research` | Deep research / literature synthesis | deep | `file-exists`, `file-size-gt`, `progress-items`, `free-form` | 2 |
| `curation` | Batch data tasks (classifying, scoring, filtering, structured output) | auto | `file-exists`, `file-size-gt`, `file-schema`, `free-form` | 1 |
| `review` | Independent multi-round review of an artifact | deep | `file-exists`, `free-form` | 1 |
| `generic` | Last-resort fallback for multi-step work | auto | all kinds | 1 |

Each profile ships with:
- A `<profile>-default.json` declaring `evaluator.checklist` (`hard: H1/H2/H3`, `soft: S1–S4`) and `evaluator.fewShotCalibrationPath`
- A `data/few-shot-rubrics/<profile>.md` worked-example file
- `src/prompts/worker-tools-<profile>.md` (per-profile tool hint injected into the worker context)
- `src/prompts/planner-examples-<profile>.md` (per-profile planner few-shot)
- A `skills/saga-<profile>/SKILL.md` with the domain-specific Q1/Q2 and delivery format

Adding a new profile means adding a `ProfileDefinition` to `src/profiles/index.ts`, a JSON file under `profiles/`, the three matching prompt/rubric files, and a skill directory. `test/profile-config.test.ts` enforces that every profile has all of those.

---

## 9. On-disk layout

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

## 10. Documentation

- [`docs/zh/codebase-walkthrough.md`](docs/zh/codebase-walkthrough.md) — 中文学习指南：以这个仓库为案例讲清楚长任务 harness 为什么这么设计、设计落在了哪些文件里
- [`CLAUDE.md`](CLAUDE.md) — contributor guidance for AI assistants working in this repo

---

## 11. License

MIT.
