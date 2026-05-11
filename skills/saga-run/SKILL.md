---
name: saga-run
description: Reference guide for saga operations — profile selection, monitoring, blocked-state handling, resume, and cancellation. To START a new saga, use a domain skill (saga-ops, saga-research, etc.) or saga-generic instead.
---

# Saga: Running a Long Task

A **Saga** wraps a multi-step task in a harness that handles context resets, rework loops, budget enforcement, and clean handoffs between stages.

## When to use a Saga

- The task will likely exceed a single context window.
- Intermediate outputs need to be verifiable (not just assumed correct).
- Work might be interrupted (user cancel, timeout, context pressure) and must resume safely.
- You need an audit trail of what was done and when.

## How to start a Saga

Call `saga_start` with the goal and the profile id that matches the task domain:

| Domain | Profile id |
|--------|------------|
| General / unknown | `generic-default` |
| Home/personal infra ops | `ops-default` |
| Deep research | `research-default` |
| Content curation | `curation-default` |
| Independent review | `review-default` |

```
saga_start(profileId="generic-default", goal="<clear, verifiable statement of what must be true when this task is done>")
```

The call returns a `sagaId`. Save it — every subsequent saga tool needs it.

## What happens after `saga_start`

The Saga harness takes over:

1. **Planner** decomposes the goal into stages and writes `spec.json` + `plan.md`.
2. For each stage, the harness runs **contract negotiation** (worker proposes scope; evaluator accepts or critiques).
3. A **worker** executes the stage against the frozen contract and writes a stage report.
4. An **evaluator** scores the report against the rubric and decides: advance, rework, or block.
5. On context pressure the worker writes a checkpoint and is restarted with a fresh context.

You do not drive individual steps — the harness drives them. Your job is to start the saga and monitor it.

## Monitoring a running Saga

```
saga_status(sagaId="<id>")
```

Returns `status`, `currentStageId`, and budget usage. Normal statuses:

| Status | Meaning |
|--------|---------|
| `planning` | Planner is decomposing the goal |
| `running` | Executing stages |
| `evaluating` | Evaluator is scoring the latest worker output |
| `blocked` | Human attention required (budget, stuck loop, or blocker issue) |
| `completed` | All stages passed |
| `cancelled` | Cancelled by operator |

## Handling a blocked Saga

When status is `blocked`, call `saga_status` to read `lastError`, then:

1. Inspect the latest checkpoint and stage eval artifacts in `.saga/<sagaId>/`.
2. Resolve the blocker (fix a failing check, adjust scope, etc.).
3. Call `saga_resume` to restart from the latest checkpoint:

```
saga_resume(sagaId="<id>", note="Resolved: <what you fixed>")
```

## Cancelling a Saga

```
saga_cancel(sagaId="<id>", reason="Optional reason")
```

State is preserved. You can still inspect artifacts and events after cancellation.

## Available profiles

Run `npm run lint-profile profiles/generic-default.json` to validate a profile file.

Each profile controls:
- Evaluation intensity (`light` / `standard` / `deep`)
- Budget limits (`maxTokens`, `maxWallClockMinutes`, `perStageTokenCap`)
- Rework limits (`maxReworkPerStage`)
- Stuck detection (`noProgressReworkLimit`)

## Important rules

- Never modify files under `.saga/<sagaId>/checkpoints/` or `task.json` directly.
- Never re-use a `sagaId` for a different goal.
- If a saga completes but the final output needs review, inspect `.saga/<sagaId>/output/` for `final-summary.md`.
