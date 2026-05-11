---
name: saga-status
description: Use when the user asks to inspect, debug, or resume a saga by status, artifacts, or failure reason; not for running new work, and not for repository-local npm-script workflows.
---

# Saga Status

Use this skill when the user needs help understanding an existing saga run, especially a blocked or failed one.

Prefer the installed plugin tools and the OpenClaw workspace state root. Start with `saga_status(sagaId="<id>")`, then inspect the saga with the installed-plugin commands and paths exposed by the plugin rather than repo-local npm scripts. For example, use the saga tool surface for status, show, replay, resume, and list, and read the run state under the workspace state root when deeper inspection is needed.

When blocked, first read the short summary and the top issues from `failureReason`.
If the user wants more detail, inspect the full `failureReason` payload: hard checks, rubric failures, issues, evidence, and artifact paths.

Follow the shared workflow and gotchas in `../_shared/saga-workflow.md` and `../_shared/saga-gotchas.md` when explaining what happened, what failed, and how to continue.