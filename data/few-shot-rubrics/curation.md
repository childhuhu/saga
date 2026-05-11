# Curation Evaluator Calibration Examples

These examples calibrate the boundary between PASS, FAIL-REWORK, and FAIL-ESCALATE.

---

## Example 1 — PASS (schema-compliant, well-scored)

**Stage goal**: Classify 50 product descriptions into 4 categories with quality scores.

**Output excerpt**:
> 48/50 records classified. All records pass schema validation (JSON Schema check: zero violations). Score distribution: 5⭐=8, 4⭐=15, 3⭐=18, 2⭐=5, 1⭐=2. No clumping — scores spread across range. Coverage: 48/50 = 96% (above 95% threshold).

**Checklist**:
- H1 PASS: All 48 output records validate against the declared schema.
- H2 PASS: Coverage 96% ≥ 95% threshold.
- H3 PASS: Score distribution shows healthy spread (not all clumped at 3).
- S1 score 5: Zero schema violations.
- S2 score 4: Scores follow rubric consistently across categories.

**Verdict**: passed=true, escalate=false, score=4.5

---

## Example 2 — FAIL-REWORK (schema violations, fixable)

**Stage goal**: Classify product descriptions into categories with quality scores.

**Output excerpt**:
> 47/50 records classified. 3 records fail schema validation: missing `category` field. Score distribution: 5⭐=0, 4⭐=3, 3⭐=42, 2⭐=2, 1⭐=0. Almost all scores cluster at 3.

**Checklist**:
- H1 FAIL-REWORK: 3 records missing required `category` field — fixable by re-processing those 3.
- H2 PASS: Coverage 47/50 = 94%, below 95% but close — fixing the 3 schema-invalid records would reach threshold.
- H3 FAIL-REWORK: 89% of scores are "3" — clear clumping. Recalibrating the scoring guide would fix this.

**Verdict**: passed=false, escalate=false, score=2.0
**Issues**: "3 records missing `category` field — re-process with explicit category extraction", "Score distribution heavily clumped at 3 — recalibrate scoring rubric"

---

## Example 3 — FAIL-ESCALATE (source data genuinely incomplete)

**Stage goal**: Classify 200 medical records into ICD-10 codes with confidence scores.

**Output excerpt**:
> 65/200 records classified. The remaining 135 records lack sufficient diagnostic information to assign an ICD-10 code — the source records are intake forms with only patient name and visit date, no diagnosis or symptoms recorded.

**Checklist**:
- H1 FAIL-ESCALATE: Schema validation passes for classified records, but the source data for 135 records physically lacks the fields needed for classification.
- H2 FAIL-ESCALATE: Coverage 32.5% — far below threshold, and the missing records cannot be classified regardless of effort.
- H3 N/A: Too few records classified to assess scoring.

**Verdict**: passed=false, escalate=true, score=1.5
**Issues**: "Source records lack diagnostic information needed for ICD-10 classification — require access to actual medical records or diagnosis fields"

**Escalation note**: The source data is genuinely incomplete. No amount of rework can classify records that don't contain the required information. Pause for human decision: obtain better source data or reduce scope to classifiable records only.

---

## Example 4 — FAIL-ESCALATE vs FAIL-REWORK boundary

The distinction: ask yourself **"If the worker re-processed the records with a better prompt or tooling, would the issues be fixable?"**

- YES (schema errors from parsing, clumped scores from unclear rubric) → FAIL-REWORK
- NO (source data physically missing required fields, contradictory schema that cannot be satisfied) → FAIL-ESCALATE

When uncertain, prefer FAIL-REWORK. Only use FAIL-ESCALATE when the source data or schema makes the criteria fundamentally unachievable.
