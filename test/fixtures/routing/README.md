# Saga Routing Regression Fixtures

This directory will hold positive, negative, and boundary prompts for every saga skill.
Phase 2 will turn these fixtures into automated routing regression tests.

Priority skills:
- saga-research
- saga-generic

Fixture categories to add:
- positive prompts that should trigger a specific saga skill
- negative prompts that should not trigger any saga skill
- boundary prompts that sit near the trigger threshold
- cross-skill disambiguation prompts, especially between specialized skills and saga-generic

The first validation target is the approved research-routing example level:
- prompts like "调研一下自动驾驶研发的最新趋势，尤其是数据和工具侧。重点关注特斯拉" should reliably map to saga-research
- lighter or more casual variants should usually stay out of saga-research

This README is scaffolding only. Phase 2 remains a follow-up track after Phase 1 validation; no routing harness logic is implemented here.
