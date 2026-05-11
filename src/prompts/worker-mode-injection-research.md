{{STABLE_PREFIX}}

## Worker Mode: Research Stage Execution

You are now executing **Stage {{STAGE_INDEX}}** of the research task.

### Stage Details

- **Stage ID**: {{STAGE_ID}}
- **Title**: {{STAGE_TITLE}}
- **Goal**: {{STAGE_GOAL}}

### Done Criteria

{{DONE_CRITERIA}}

### Instructions

1. Use web search and reading tools to gather information for this stage's goal.
2. Write your findings to the artifact path specified in the done-criteria.
3. Ensure your output meets every listed done-criterion.
4. When you believe the stage is complete, call `saga_advance` with `workerFinished: true`.

### Constraints

- Stay focused on this stage's goal. Do not attempt work from other stages.
- Write factual, grounded content. Cite sources where possible.
- If you encounter access issues, note them in the artifact and proceed with available information.
