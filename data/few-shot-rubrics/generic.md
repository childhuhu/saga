# Generic Evaluator Calibration Examples

These examples calibrate the boundary between PASS, FAIL-REWORK, and FAIL-ESCALATE.

---

## Example 1 — PASS (goal addressed, self-contained)

**Stage goal**: Produce a consolidated inventory of all PDF files in the project with page counts.

**Output excerpt**:
> Found 12 PDF files across 4 directories. Summary:
>
> | File | Pages | Size |
> |------|-------|------|
> | docs/architecture.pdf | 15 | 2.1 MB |
> | docs/api-reference.pdf | 42 | 5.8 MB |
> | … (10 more rows) |
>
> Total: 12 files, 187 pages, 34.2 MB. Largest: `docs/api-reference.pdf` (42 pages). Smallest: `assets/logo.pdf` (1 page).

**Checklist**:
- H1 PASS: Output directly addresses the stated goal — every PDF is listed with page count.
- H2 PASS: Result is self-contained: summary table + totals + extremes. No reference to external context needed.
- H3 PASS: Done-criteria satisfied (file-exists for the report, content matches expected format).
- S1 score 5: Complete inventory with no gaps.
- S3 score 4: Includes useful derived metrics (totals, extremes) beyond bare minimum.

**Verdict**: passed=true, escalate=false, score=4.5

---

## Example 2 — FAIL-REWORK (incomplete, fixable)

**Stage goal**: List all open GitHub issues labeled "bug" with reproduction steps.

**Output excerpt**:
> Found 8 bug-labeled issues. Extracted reproduction steps for 5 of them. The remaining 3 issues do not have explicit reproduction steps in the issue body — they contain only stack traces without setup instructions.

**Checklist**:
- H1 FAIL-REWORK: Only 5/8 issues have reproduction steps — the worker can extract implicit steps from stack traces with more effort.
- H2 FAIL-REWORK: Result is incomplete but the data exists in the issues; re-processing with a stricter extraction prompt would help.
- H3 FAIL-REWORK: 3 issues lack explicit steps, but the stack traces contain enough signal to infer them.

**Verdict**: passed=false, escalate=false, score=2.5
**Issues**: "3 issues missing reproduction steps — re-extract from stack trace content with explicit step inference", "Add a column indicating inferred vs explicit steps"

---

## Example 3 — FAIL-ESCALATE (contradictory requirements)

**Stage goal**: Generate a single markdown report that is simultaneously under 500 words AND contains the full unabridged text of all 12 source documents.

**Output excerpt**:
> Unable to complete: the source documents total approximately 15,000 words. A single report under 500 words cannot contain the full unabridged text. These requirements are contradictory.

**Checklist**:
- H1 FAIL-ESCALATE: The goal contains mutually exclusive constraints (under 500 words + full text of 15,000 words). No rework can satisfy both.
- H2 FAIL-ESCALATE: No valid output exists for the given constraints.
- H3 FAIL-ESCALATE: Done-criteria cannot be simultaneously satisfied.

**Verdict**: passed=false, escalate=true, score=1.0
**Issues**: "Goal requirements are contradictory — word limit precludes full text inclusion. Human must resolve constraint conflict."

**Escalation note**: The goal is inherently unsatisfiable. No amount of rework can produce a report under 500 words that contains 15,000 words of source text. Pause for human decision: relax word limit or switch to summary mode.

---

## Example 4 — FAIL-ESCALATE vs FAIL-REWORK boundary

The distinction: ask yourself **"Does a valid output exist that satisfies the goal?"**

- YES, but the current output falls short (missing rows, partial extraction, formatting errors) → FAIL-REWORK
- NO (contradictory constraints, circular dependencies, impossible scope) → FAIL-ESCALATE

When uncertain, prefer FAIL-REWORK. Only use FAIL-ESCALATE when the goal itself is fundamentally unsatisfiable.
