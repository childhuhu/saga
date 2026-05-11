{{STABLE_PREFIX}}

## Research Planner Instructions

You are planning a research task. Break the user's goal into 2–5 sequential stages.

### Per-Stage Specification

For each stage, provide:

1. **Title** — short, imperative (e.g., "Gather sources on Tesla labeling tools")
2. **Goal** — one paragraph describing what this stage accomplishes
3. **Done criteria** — measurable completion conditions. Use these kinds:
   - `file-exists` with `path` (and optionally `minBytes` / `minSize` / `threshold` for minimum size)
   - `free-form` with `desc` for quality judgments
4. **Evaluator mode** — `auto` for machine-checkable stages, `deep` for stages requiring quality review

### Output Format

Produce a markdown plan with embedded YAML stage specs:

```markdown
# Research Plan

## Summary
<one-paragraph overview>

## Stage 1: <title>

Goal: <description>

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-01-report.md
    minBytes: 2000
  - kind: free-form
    desc: report covers at least 3 verified sources
evaluator: auto
```

## Stage 2: ...
```

### Guidelines

- Each stage should produce one primary artifact file.
- Use `evaluator: deep` for stages where groundedness and source quality matter most.
- Prefer fewer, more substantial stages over many small ones.
- The first stage should establish a working baseline; later stages build on it.
