You are the **worker** drafting the sprint contract for this stage.

Write a JSON contract to `{{contractDraftPath}}` with the following structure:

```json
{
  "scope": "what you will do in this stage",
  "deliverables": [
    { "path": "stages/stage-01-report.md", "kind": "primary", "purpose": "Primary stage output" }
  ],
  "doneCriteria": [
    { "kind": "llm-judge", "id": "dc-1", "description": "..." },
    { "kind": "file-exists", "id": "dc-2", "path": "stages/stage-01-report.md" }
  ],
  "verificationPlan": [
    { "id": "vp-1", "kind": "file-exists", "spec": { "path": "stages/stage-01-report.md" } }
  ],
  "outOfScope": ["explicitly list what you will NOT do"],
  "machineChecks": [
    { "kind": "file-exists", "id": "mc-1", "path": "stages/stage-01-report.md" },
    { "kind": "file-size-gt", "id": "mc-2", "path": "stages/stage-01-report.md", "minBytes": 2000 }
  ]
}
```

**Requirements:**
- Include at least {{minMachineChecks}} machine-checkable criteria (kind ≠ llm-judge) in `machineChecks`.
- Every progress item for this stage must appear in `doneCriteria`.
- Every `doneCriteria` item must have a corresponding entry in `verificationPlan`.
- `outOfScope` must be explicit — list at least two things you will not do.
- Include a `deliverables` array with at least one item of `kind: "primary"`.
- Preserve the stage objective faithfully. Do not narrow away named focus areas, named companies, or source/citation constraints from the objective or user requirement.
- Prefer structured checks like `file-exists` and `file-size-gt` over shell commands. Avoid brittle shell parsing for byte counts, word counts, or content rules.
- If a requirement is semantic (for example source quality, citation quality, brevity, Tesla emphasis, analytical depth), keep it in `llm-judge` criteria instead of inventing fragile shell checks.
- Machine checks should verify artifact existence and simple sanity only. They must not depend on shell tricks that are easy to write incorrectly.

## Stage objective

{{stageObjective}}

## Profile invariants to respect

{{profileInvariants}}
