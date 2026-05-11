# Research Evaluator Calibration Examples

These examples calibrate the boundary between PASS, FAIL-REWORK, and FAIL-ESCALATE.

---

## Example 1 — PASS (well-cited, specific)

**Stage goal**: Analyse Tesla's data engine and auto-labelling pipeline.

**Output excerpt**:
> Tesla's FSD v12 (released Dec 2023 [1]) uses an end-to-end neural network trained entirely on video data. According to Tesla's 2023 AI Day presentation [2], the auto-labelling pipeline processes approximately 1.5 billion frames per day using a "teacher" model running in the cloud. Andrej Karpathy's 2022 interview [3] described the data engine as a closed loop: edge cases trigger retrieval of similar clips, which are re-labelled and fed back into training within 48 hours.
>
> References: [1] Tesla Q4 2023 earnings call transcript. [2] Tesla AI Day 2023 recording. [3] Lex Fridman podcast #333.

**Checklist**:
- H1 PASS: Three numbered citations with identifiable sources.
- H2 PASS: Goal fully addressed — pipeline mechanics, scale, and timeline described.
- H3 PASS: Specific figures (1.5B frames/day, 48h cycle, v12 Dec 2023).
- S1 score 4: Three independent sources (earnings, AI Day, podcast).
- S2 score 4: Cross-source synthesis (Karpathy + AI Day confirm same loop).

**Verdict**: passed=true, escalate=false, score=4.0

---

## Example 2 — FAIL-REWORK (claims not cited, but sources exist)

**Stage goal**: Summarise the NHTSA investigation into Tesla Autopilot.

**Output excerpt**:
> Tesla has been under NHTSA investigation since 2021 due to multiple crashes involving Autopilot. The agency found that Autopilot was active in many fatal accidents. Tesla issued a software recall in 2022 to address the issue.

**Checklist**:
- H1 FAIL-REWORK: No citations at all. NHTSA press releases and Reuters reporting on this topic are publicly available.
- H2 PASS: Goal addressed at high level.
- H3 FAIL-REWORK: No case numbers, dates, or specific recall details.

**Verdict**: passed=false, escalate=false, score=2.0
**Issues**: "Claims about NHTSA investigation lack citations — use NHTSA press releases and Reuters/Bloomberg reporting", "Recall date and scope missing — NHTSA ODI #PE21020 is public record"

---

## Example 3 — FAIL-ESCALATE (information genuinely unavailable)

**Stage goal**: Detail Tesla's internal training data volume per model version.

**Output excerpt**:
> Tesla trains FSD on proprietary data. The exact volume per model version is not publicly disclosed. Based on indirect estimates from Karpathy interviews, training runs likely use hundreds of billions of tokens, but Tesla has not confirmed exact figures per version.

**Checklist**:
- H1 PASS: One source (Karpathy interview) cited.
- H2 FAIL-ESCALATE: The goal asks for "per model version" training data volumes. Tesla does not disclose this. No amount of additional research would produce verified numbers — this is proprietary operational data.
- H3 FAIL-ESCALATE: Specific internal metrics about model versions are not in the public domain.

**Verdict**: passed=false, escalate=true, score=2.5
**Issues**: "Training data volume per model version is proprietary and not publicly disclosed — criterion cannot be met without internal access"

**Escalation note**: The worker found the limits of public information. The evaluator should NOT ask for rework here — rework would produce guesses, not facts. This should pause for human decision: relax scope to "publicly available estimates" or cancel the specific sub-goal.

---

## Example 4 — FAIL-ESCALATE vs FAIL-REWORK boundary

The distinction: ask yourself **"If the worker did more web searches and read more documents, would this criterion be satisfiable?"**

- YES → FAIL-REWORK
- NO (information simply doesn't exist publicly) → FAIL-ESCALATE

When uncertain, prefer FAIL-REWORK. Only use FAIL-ESCALATE when you are confident the information is proprietary, classified, or not in the public record.
