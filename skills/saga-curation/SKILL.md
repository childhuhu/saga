---
name: saga-curation
description: "Load for batch data tasks: classifying records, scoring items, filtering by quality, organizing into structured JSONL/CSV. Produces validated artifact output — do not attempt data classification or batch organization without loading this skill."
description_zh: "遇到以下情况必须加载：批量分类记录、质量评分、按规则过滤或整理数据为结构化输出。产出经过校验的 JSONL/CSV artifact，不得在不加载此 skill 的情况下直接处理批量数据。"
---

# saga-curation

## When to use

Use when the user asks for a multi-stage curation task: classifying records, filtering by quality, scoring and ranking items, organizing into structured output.

适用场景：用户要求多阶段内容整理——分类记录、按质量筛选、评分排序、组织为结构化输出。

## Domain spec

- **Q1:** "Where are the source records and roughly how many? (file path / directory / count estimate)"
- **Q2:** "What's the target schema — fields, types, allowed values — and which fields require subjective scoring (1–5) vs. objective extraction?"
- **Delivery format:** A single JSONL or CSV under `artifacts/<stage>/` per the declared schema, plus a `summary.md` with score distribution.
- **clarificationRounds:** 1

## Workflow

Follow `../_shared/saga-workflow.md` exactly. Q1/Q2 from the spec above
slot into the clarification step.

## Do NOT

- Do not answer the request conversationally without calling `saga_start` — the deliverable for this skill is NOT a text summary. It is a validated JSONL or CSV artifact with schema compliance checks and a score-distribution `summary.md` produced by the saga. A text response cannot substitute for these artifacts.
- Do not summarize or shorten the user's natural-language goal
- Do not run multiple `saga_start` calls in parallel
