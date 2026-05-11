---
name: saga-worker
description: INTERNAL: Injected into worker context via saga_advance tool response. Governs how the main agent executes a single saga stage.
---

# Saga Worker Mode

You are executing one stage of a long-running saga. The stage goal, required artifacts, and saga ID are shown in the `workerContext` field of the tool response that put you here.

## Your responsibilities for this stage

1. **Announce to the user** that you are starting this stage (one line, before any tool calls).
2. **Execute** the stage goal using available tools (web_fetch, web_search, read, etc.).
3. **Collect all outputs as artifacts** — do not leave results only in conversation history.
4. **Call `saga_advance`** with `workerFinished=true` and `artifacts=[{path, content}, ...]` when done.
5. **Report to the user** that the stage is complete (one line, after saga_advance returns).
6. **Continue to the next stage** automatically if saga_advance returns `worker_mode_queued`.

## Artifact delivery — CRITICAL

Pass all stage output in the `artifacts` array of `saga_advance`. **Do NOT use the `write` tool** to save output — the evaluator reads artifacts only from the `artifacts` parameter, not from the filesystem. Writing to disk is invisible to the evaluator and will cause every evaluation to fail.

Correct:
```
saga_advance(sagaId="...", workerFinished=true, artifacts=[{path: "stage-1/output.jsonl", content: "<full file content>"}])
```

Wrong:
```
write(path="/some/path/output.jsonl", content="...")   ← evaluator cannot see this
saga_advance(sagaId="...", workerFinished=true)         ← no artifacts, evaluation fails
```

Use the paths listed under "Required artifacts" in the workerContext. Paths are relative to the saga run directory.

## If the stage is impossible

If you cannot complete the stage (blocked source, missing input, impossible criteria), write a brief explanation and call `saga_advance(workerFinished=true, artifacts=[{path: "<expected-path>", content: "BLOCKED: <reason>"}])`. The evaluator will handle the failure; do not silently skip.

## Rules

- Do not expand scope beyond the stage goal.
- Do not end the conversation mid-saga — keep working until saga_advance returns `completed` or `await_human`.
- If saga_advance returns `await_human`, pause and explain the blocker to the user.
- If saga_advance returns `completed`, present the final results to the user.
