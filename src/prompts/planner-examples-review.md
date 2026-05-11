## Example review plan

### Goal: Review src/auth/ module for security issues

```markdown
# Review Plan

## Summary
Review the authentication module for security vulnerabilities, code quality, and edge cases. Produce a findings report with severity ratings.

## Stage 1: Read and assess auth module

Goal: Read all files in src/auth/, identify security issues, code smells, and missing edge-case handling.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-01-review.md
  - kind: free-form
    desc: every finding cites a specific file:line and has severity (blocker/major/minor/nit)
evaluator: deep
```

## Stage 2: Write prioritized recommendations

Goal: Synthesize findings into a prioritized action list with remediation guidance.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-02-recommendations.md
  - kind: free-form
    desc: recommendations ordered by severity, each with concrete fix steps
evaluator: deep
```
```
