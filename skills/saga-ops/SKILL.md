---
name: saga-ops
description: "Load for home/personal infrastructure problems: WiFi drops, slow network, device config, recurring issues. Produces structured diagnosis + runbook artifacts — do not answer ops requests without loading this skill."
description_zh: "遇到以下情况必须加载：WiFi断连、网速慢、设备配置、反复出现的基础设施问题。产出结构化诊断报告和可执行手册，不得在不加载此 skill 的情况下直接回答运维问题。"
---

# saga-ops

## When to use

Use when the user asks for home/personal infrastructure operations: network diagnosis (WiFi drops, slow connections), device configuration, recurring-issue remediation. The saga uses command-based hard checks and writes incident memory for future lookups.

适用场景：用户要求家庭/个人基础设施运维——网络诊断（WiFi 断连、速度慢）、设备配置、反复出现的问题修复。使用命令行验证并写入故障记忆供未来查询。

## Domain spec

- **Q1:** "What's the symptom and what changed recently? (network slow since X, can't reach Y after upgrade, …)"
- **Q2:** "Which devices/networks are in scope, and is there an existing memory entry for this issue I should pull up first?"
- **Delivery format:** Two artifacts — `artifacts/<stage>/diagnosis.md` (claims+evidence table) and `artifacts/<stage>/runbook.md` (commands and reverts). Memory entry appended at end.
- **clarificationRounds:** 2

## Workflow

Follow `../_shared/saga-workflow.md` exactly. Q1/Q2 from the spec above
slot into the clarification step.

## Do NOT

- Do not answer the request conversationally without calling `saga_start` — the deliverable for this skill is NOT a text explanation. It is a verified `diagnosis.md` (claims + evidence table) and `runbook.md` (commands + reverts) produced by the saga. A text answer cannot substitute for these artifacts.
- Do not summarize or shorten the user's natural-language goal
- Do not run multiple `saga_start` calls in parallel
