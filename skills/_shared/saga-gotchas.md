# Saga shared gotchas

- Clarify requirements before planning. If the ask is underspecified, get the missing context first instead of locking in a plan.
- `saga_status` is for inspection, `saga_resume` continues a blocked stage, and `saga_advance` moves to the next stage after a successful result. Do not blur those roles.
- Metadata is not a deliverable. It can help coordinate work, but it does not count as the actual output.
- `skipBlockedStage` can keep a run moving, but it may reduce completeness or leave gaps in the final result.
- Saga state lives under the OpenClaw workspace state root, not in repo-local scratch paths. Inspect the installed-plugin state location when debugging or resuming runs.

Use these reminders to choose the right recovery path and to avoid overclaiming progress.