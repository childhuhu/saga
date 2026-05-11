---
name: saga-generic
description: Fallback for any multi-step coordinated task that does not match a specialized saga skill — inventorying items, building checklists, auditing status, or any open-ended work that benefits from staged planning and progress tracking. Always prefer a domain-specific saga skill when the request clearly fits; use this only as the last resort.
description_zh: 兜底多步任务——盘点、建清单、审计状态或任何需要分阶段规划的多步工作。优先使用领域专用 skill；此 skill 仅作最后手段。
---

# saga-generic

## When to use

Use when the user asks for a coordinated multi-step task that doesn't match ops, research, review, or curation. Examples: inventorying items, building checklists, auditing status, any open-ended work that benefits from staged planning.

适用场景：用户要求协调多步任务，但不匹配运维、研究、复审或整理。例如：盘点、建清单、审计状态等。

## Domain spec

- **Q1:** "What's the deliverable in one sentence?"
- **Q2:** "What does 'done' look like — what would I be able to point to when I want to verify it?"
- **Delivery format:** Free-form, declared in the plan.
- **clarificationRounds:** 1

## Workflow

Follow `../_shared/saga-workflow.md` exactly. Q1/Q2 from the spec above
slot into the clarification step.

## Do NOT

- Do not answer the request without calling `saga_start`
- Do not summarize or shorten the user's natural-language goal
- Do not run multiple `saga_start` calls in parallel
