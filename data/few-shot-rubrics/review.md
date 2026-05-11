# Review Evaluator Calibration Examples

These examples calibrate the boundary between PASS, FAIL-REWORK, and FAIL-ESCALATE.

---

## Example 1 — PASS (well-cited, thorough)

**Stage goal**: Review src/auth/ module for security issues.

**Output excerpt**:
> **Finding 1 (BLOCKER)**: `src/auth/login.ts:42` — SQL injection via string interpolation in the WHERE clause. `query('SELECT * FROM users WHERE name = \'' + name + "'")` allows arbitrary SQL execution.
>
> **Finding 2 (MAJOR)**: `src/auth/session.ts:18` — Session tokens stored in localStorage without HttpOnly flag, vulnerable to XSS exfiltration.
>
> **What was checked**: All 7 files in src/auth/, focusing on input validation, auth token handling, and session management.
> **What was NOT checked**: Third-party auth dependencies (no access to node_modules), rate limiting (requires runtime testing).

**Checklist**:
- H1 PASS: Both findings cite exact file:line locations with code quotes.
- H2 PASS: Both have severity with rationale (blocker = remote code execution; major = XSS vector).
- H3 PASS: Explicit scope and out-of-scope sections listed.
- S1 score 5: Non-obvious finding (SQL injection via string concat, not just parameterized query missing).
- S4 score 5: Both findings have concrete fix recommendations.

**Verdict**: passed=true, escalate=false, score=4.7

---

## Example 2 — FAIL-REWORK (vague findings, fixable)

**Stage goal**: Review the API handler for correctness and edge cases.

**Output excerpt**:
> The API handler has some issues. Error handling could be better. There might be race conditions in the concurrent request handling. Overall the code quality is acceptable but needs improvement.

**Checklist**:
- H1 FAIL-REWORK: No file:line citations, no code quotes — the reviewer can add specifics from the source.
- H2 FAIL-REWORK: No severity assigned, no rationale for any finding.
- H3 FAIL-REWORK: No explicit scope statement — unclear what was and wasn't reviewed.

**Verdict**: passed=false, escalate=false, score=1.5
**Issues**: "Cite specific file:line locations for each finding", "Assign severity (blocker/major/minor/nit) with rationale", "State what was and was not reviewed"

---

## Example 3 — FAIL-ESCALATE (artifact not supplied)

**Stage goal**: Review the security architecture document.

**Output excerpt**:
> The architecture document was not found at the specified path (`/docs/architecture.md`). Without access to the document, no review can be performed.

**Checklist**:
- H1 FAIL-ESCALATE: Cannot cite findings from an artifact that doesn't exist or is inaccessible.
- H2 N/A: No findings to assess severity.
- H3 FAIL-ESCALATE: Cannot state coverage of an unavailable document.

**Verdict**: passed=false, escalate=true, score=0
**Issues**: "Artifact not found at /docs/architecture.md — review cannot proceed without the source material"

**Escalation note**: The artifact is unavailable. Rework cannot produce findings from a document the reviewer cannot read. Pause for human decision: provide the correct path or reschedule.

---

## Example 4 — FAIL-ESCALATE vs FAIL-REWORK boundary

The distinction: ask yourself **"If the reviewer spent more time reading the artifact, could they produce the missing findings?"**

- YES (findings are vague but the artifact is available) → FAIL-REWORK
- NO (artifact doesn't exist, artifact is too large to review in scope, or access is denied) → FAIL-ESCALATE

When uncertain, prefer FAIL-REWORK. Only use FAIL-ESCALATE when the artifact is genuinely unavailable or the review scope is impossible to cover.
