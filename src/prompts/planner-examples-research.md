## Example research plan

### Goal: Compare React vs Vue for a new dashboard project

```markdown
# Research Plan

## Summary
Research React and Vue ecosystems to recommend one for a dashboard project, covering performance, ecosystem maturity, and hiring outlook.

## Stage 1: Gather sources on React ecosystem

Goal: Collect 5+ sources on React's performance characteristics, tooling, and hiring market.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-01-report.md
    minBytes: 2000
  - kind: free-form
    desc: report cites at least 5 distinct sources with inline markers
evaluator: deep
```

## Stage 2: Gather sources on Vue ecosystem

Goal: Same scope as Stage 1 but for Vue — performance, tooling, hiring market.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-02-report.md
    minBytes: 2000
  - kind: free-form
    desc: report cites at least 5 distinct sources
evaluator: deep
```

## Stage 3: Synthesize comparison

Goal: Write a comparison report synthesizing findings from both stages with a recommendation.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-03-report.md
    minBytes: 3000
  - kind: free-form
    desc: report has explicit recommendation with evidence
evaluator: deep
```
```
