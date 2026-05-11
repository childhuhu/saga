---
name: saga-research
description: Run a multi-stage research saga on a topic with verified sources
description_zh: 对一个主题运行多阶段研究任务，产出有据可查的报告
---

# saga-research

## When to use

Use when the user asks for a multi-stage research task: surveying a topic, comparing sources, synthesizing findings into a grounded report. Not for quick fact lookups, single-source answers, or narrow web searches.

适用场景：用户要求多阶段研究任务——调研主题、比较多个来源、综合分析并撰写有据可查的报告。不适用于快速查询、单一来源回答或狭窄的网络搜索。

## Domain spec

- **Q1:** "Internal sources only, external only, or both? (e.g., your prior docs vs. public web vs. mixed)"
- **Q2:** "What's the deliverable shape — a free-form report, a structured comparison table, an executive summary, or something else?"
- **Delivery format:** Markdown report under `artifacts/<stage>/report.md` with explicit `## References` section.
- **clarificationRounds:** 2

## Workflow

Follow `../_shared/saga-workflow.md` exactly. Q1/Q2 from the spec above
slot into the clarification step.

## Do NOT

- Do not skip Q1 and Q2 — research always requires source scope (internal/external/both) and deliverable format from the user, regardless of how specific the topic seems
- Do not answer the request without calling `saga_start`
- Do not summarize or shorten the user's natural-language goal
- Do not run multiple `saga_start` calls in parallel
