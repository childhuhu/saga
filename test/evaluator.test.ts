/**
 * Unit tests for evaluator modules.
 */

import { describe, it, expect } from 'vitest';
import { parseDeepEvalVerdict, buildDeepEvalPrompt } from '../src/roles/evaluator-deep.js';
import { getProfile } from '../src/profiles/index.js';
import type { EvalChecklistType } from '../src/profiles/checklist-schema.js';

const STUB_CHECKLIST: EvalChecklistType = {
  hard: [
    { id: 'H1', title: 'Test H1', passDescription: 'pass', failReworkDescription: 'rework', failEscalateDescription: 'escalate' },
  ],
  soft: [
    { id: 'S1', title: 'Test S1', weight: 1.0, scoringGuide: '5=best; 1=worst' },
  ],
};

describe('parseDeepEvalVerdict', () => {
  it('parses valid JSON verdict', () => {
    const result = parseDeepEvalVerdict('```json\n{"passed": true, "score": 4.2, "issues": []}\n```');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(4.2);
    expect(result.issues).toHaveLength(0);
  });

  it('parses JSON embedded in prose', () => {
    const result = parseDeepEvalVerdict(
      'Here is my evaluation:\n{"passed": false, "score": 2.5, "issues": ["Missing sources", "Poor structure"]}\nThank you.',
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(2.5);
    expect(result.issues).toHaveLength(2);
  });

  it('handles non-JSON output', () => {
    const result = parseDeepEvalVerdict('I cannot evaluate this output.');
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Deep evaluator output was not valid JSON');
  });

  it('handles malformed JSON', () => {
    const result = parseDeepEvalVerdict('{"passed": true, "score":');
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('buildDeepEvalPrompt', () => {
  it('includes stage details, done criteria, and checklist items', () => {
    const prompt = buildDeepEvalPrompt({
      stageId: 'stage-01',
      stageTitle: 'Gather sources',
      stageGoal: 'Find 5 sources',
      doneCriteriaText: '- kind: file-exists, path: report.md',
      artifactContent: 'This is the report content.',
      profile: getProfile('research'),
      fewShotExamples: '',
      checklist: STUB_CHECKLIST,
    });
    expect(prompt).toContain('stage-01');
    expect(prompt).toContain('Gather sources');
    expect(prompt).toContain('Find 5 sources');
    expect(prompt).toContain('file-exists');
    expect(prompt).toContain('This is the report content.');
    expect(prompt).toContain('H1 — Test H1');
    expect(prompt).toContain('S1 — Test S1');
  });
});
