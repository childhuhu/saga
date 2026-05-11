## Example curation plan

### Goal: Classify 50 product descriptions into 4 categories with quality scores

```markdown
# Curation Plan

## Summary
Read product descriptions from input.jsonl, classify each into electronics/clothing/food/books, assign a quality score (1–5), and write structured output.

## Stage 1: Process and classify records

Goal: Classify all 50 records into the 4 categories with quality scores, write to output.jsonl.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-01-output.jsonl
  - kind: file-size-gt
    path: artifacts/stages/stage-01-output.jsonl
    minBytes: 5000
evaluator: auto
```

## Stage 2: Validate and summarize

Goal: Verify schema compliance, check score distribution, write summary.md.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-02-summary.md
  - kind: free-form
    desc: summary includes score distribution table and schema compliance rate
evaluator: auto
```
```
