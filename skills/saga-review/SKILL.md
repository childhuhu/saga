---
name: saga-review
description: Run a multi-stage review saga to audit, assess, and produce a structured findings report
description_zh: 运行多阶段复审任务：审计、评估并产出结构化的发现报告
---

# saga-review

## When to use

Use when the user asks for a multi-stage review task: auditing a codebase, reviewing a design document, assessing a PR for issues. Not for casual opinions, quick spot checks, or single-pass feedback.

适用场景：用户要求多阶段复审任务——审计代码库、审查设计文档、评估 PR 问题。不适用于随意评论、快速检查或单次反馈。

## Domain spec

- **Q1:** "What's the artifact and where does it live? (path/URL/pasted content)"
- **Q2:** "What's the lens — correctness, completeness, design coherence, ops-readiness, security, or something specific you're worried about?"
- **Delivery format:** A single `artifacts/<stage>/review.md` with sections: Summary, Findings (table with severity), What was checked, What was NOT checked, Recommended next actions.
- **clarificationRounds:** 1

## Workflow

Follow `../_shared/saga-workflow.md` exactly. Q1/Q2 from the spec above
slot into the clarification step.

## Do NOT

- Do not answer the request without calling `saga_start`
- Do not summarize or shorten the user's natural-language goal
- Do not run multiple `saga_start` calls in parallel
