## Example generic plan

### Goal: Inventory all PDF files in /docs and produce a metadata index

```markdown
# Generic Plan

## Summary
Scan /docs for PDF files, extract metadata (title, page count, last-modified), and write a structured index.

## Stage 1: Scan and extract metadata

Goal: Find all PDFs in /docs, extract metadata for each, write to index.jsonl.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-01-index.jsonl
  - kind: file-size-gt
    path: artifacts/stages/stage-01-index.jsonl
    minBytes: 500
evaluator: auto
```

## Stage 2: Validate and summarize

Goal: Verify index completeness, write a summary of coverage and any gaps.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-02-summary.md
evaluator: auto
```
```
