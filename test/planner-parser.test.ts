/**
 * Unit tests for planner output parsing.
 */

import { describe, it, expect } from 'vitest';
import { parsePlannerOutput, buildPlannerFeedback } from '../src/roles/planner.js';

describe('parsePlannerOutput', () => {
  it('parses a full markdown plan with embedded YAML', () => {
    const output = `# Research Plan

## Summary
A comprehensive research plan to investigate Tesla labeling tools.

## Stage 1: Gather sources on Tesla labeling tools

Goal: Find and verify 5+ sources about Tesla's data labeling infrastructure.

\`\`\`yaml
done:
  - kind: file-exists
    path: stages/stage-01-report.md
    minBytes: 2000
  - kind: free-form
    desc: report covers at least 3 verified sources
evaluator: auto
\`\`\`

## Stage 2: Synthesize findings

Goal: Combine all gathered information into a cohesive analysis.

\`\`\`yaml
done:
  - kind: file-exists
    path: stages/stage-02-analysis.md
    minSize: 3000
evaluator: deep
\`\`\`
`;

    const result = parsePlannerOutput(output);
    expect(result.stages).toHaveLength(2);
    expect(result.summary).toContain('Tesla labeling tools');

    expect(result.stages[0]!.id).toBe('stage-01');
    expect(result.stages[0]!.title).toBe('Gather sources on Tesla labeling tools');
    expect(result.stages[0]!.goal).toContain('5+ sources');
    expect(result.stages[0]!.doneCriteria).toHaveLength(2);
    expect(result.stages[0]!.doneCriteria[0]!.kind).toBe('file-exists');
    expect(result.stages[0]!.evaluatorMode).toBe('auto');

    expect(result.stages[1]!.title).toBe('Synthesize findings');
    expect(result.stages[1]!.evaluatorMode).toBe('deep');
    expect(result.stages[1]!.doneCriteria[0]!.minBytes).toBe(3000); // normalized from minSize
  });

  it('handles empty output gracefully', () => {
    const result = parsePlannerOutput('');
    expect(result.stages).toHaveLength(0);
    expect(result.summary).toBe('');
  });

  it('creates free-form fallback for unparseable YAML', () => {
    const output = `## Stage 1: Broken
Goal: do stuff
\`\`\`yaml
this is not valid yaml at all !!!
\`\`\`
`;
    const result = parsePlannerOutput(output);
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]!.doneCriteria[0]!.kind).toBe('free-form');
  });

  it('extracts goal from Goal: prefix line', () => {
    const output = `## Stage 1: Test
Goal: This is the goal text.
\`\`\`yaml
done:
  - kind: file-exists
    path: a.md
\`\`\`
`;
    const result = parsePlannerOutput(output);
    expect(result.stages[0]!.goal).toBe('This is the goal text.');
  });
});

describe('buildPlannerFeedback', () => {
  it('returns empty string for no missing fields', () => {
    expect(buildPlannerFeedback([])).toBe('');
  });

  it('formats missing fields as feedback', () => {
    const feedback = buildPlannerFeedback(['stage-01: done.path', 'stage-02: goal']);
    expect(feedback).toContain('stage-01: done.path');
    expect(feedback).toContain('Please revise');
  });
});
