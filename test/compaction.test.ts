/**
 * Unit tests for compaction pipeline (microcompact, context-collapse, prefix-builder).
 */

import { describe, it, expect } from 'vitest';
import { microcompactEval, isAlreadyCompacted } from '../src/compaction/microcompact.js';
import { collapseHistory } from '../src/compaction/context-collapse.js';
import { assemblePrompt, buildStageDynamic, getProfileSuffix } from '../src/compaction/prefix-builder.js';
import type { CompactEval } from '../src/compaction/microcompact.js';

describe('microcompact', () => {
  it('compacts a full eval to minimal form', () => {
    const result = microcompactEval(
      { passed: true, issues: [], score: 0.92, summary: 'Good work' },
      'stage-01',
    );
    expect(result.verdict).toBe('passed');
    expect(result.score).toBe(0.92);
    expect(result.summary).toBe('Good work');
    expect(result.pointer).toBe('see-original-at-stage-01-eval.json');
  });

  it('truncates long summaries to 200 chars', () => {
    const longSummary = 'A'.repeat(300);
    const result = microcompactEval(
      { passed: false, issues: ['x'], details: longSummary },
      'stage-02',
    );
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary.endsWith('...')).toBe(true);
  });

  it('uses issues as fallback for summary', () => {
    const result = microcompactEval(
      { passed: false, issues: ['missing X', 'bad Y'] },
      'stage-03',
    );
    expect(result.verdict).toBe('rework');
    expect(result.summary).toContain('missing X');
  });
});

describe('isAlreadyCompacted', () => {
  it('detects compacted evals', () => {
    const compact: CompactEval = {
      verdict: 'passed',
      score: 0.9,
      summary: 'ok',
      pointer: 'see-original',
    };
    expect(isAlreadyCompacted(compact)).toBe(true);
  });

  it('rejects full evals', () => {
    expect(isAlreadyCompacted({ passed: true, issues: [] })).toBe(false);
  });
});

describe('collapseHistory', () => {
  it('gives full detail for distance ≤ 1', () => {
    const entries = [
      { stageId: 'stage-01', index: 0, evalData: { passed: true, score: 0.9 } },
    ];
    const collapsed = collapseHistory(entries, 1);
    expect(collapsed[0]!.level).toBe('full');
  });

  it('gives compact for distance 2–3', () => {
    const entries = [
      { stageId: 'stage-01', index: 0, evalData: { passed: true, score: 0.85 } },
    ];
    const collapsed = collapseHistory(entries, 2);
    expect(collapsed[0]!.level).toBe('compact');
  });

  it('gives one-line summary for distance ≥ 4', () => {
    const entries = [
      { stageId: 'stage-01', index: 0, evalData: { passed: true } },
    ];
    const collapsed = collapseHistory(entries, 5);
    expect(collapsed[0]!.level).toBe('summary');
    if (collapsed[0]!.level === 'summary') {
      expect(collapsed[0]!.line).toContain('stage-01');
    }
  });

  it('handles mixed distances', () => {
    const entries = [
      { stageId: 'stage-01', index: 0, evalData: { passed: true, score: 0.7 } },
      { stageId: 'stage-02', index: 2, evalData: { passed: true, score: 0.8 } },
      { stageId: 'stage-03', index: 3, evalData: { passed: true, score: 0.9 } },
    ];
    const collapsed = collapseHistory(entries, 4);
    expect(collapsed[0]!.level).toBe('summary');    // distance 4
    expect(collapsed[1]!.level).toBe('compact');    // distance 2
    expect(collapsed[2]!.level).toBe('full');       // distance 1
  });
});

describe('prefix-builder', () => {
  it('assembles prompt from three sections', () => {
    const prompt = assemblePrompt({
      stablePrefix: '## Stable Prefix',
      profileSuffix: '## Research Profile',
      stageDynamic: '## Stage 1 details',
    });
    expect(prompt).toContain('## Stable Prefix');
    expect(prompt).toContain('## Research Profile');
    expect(prompt).toContain('## Stage 1 details');
  });

  it('builds stage dynamic with done criteria', () => {
    const dynamic = buildStageDynamic({
      sagaId: 'saga-1',
      stageId: 'stage-01',
      stageTitle: 'Test stage',
      stageGoal: 'Do something',
      doneCriteria: [
        { kind: 'file-exists', path: 'report.md' },
        { kind: 'command', command: 'npm test' },
      ],
      compactedHistory: [],
    });
    expect(dynamic).toContain('saga-1');
    expect(dynamic).toContain('stage-01');
    expect(dynamic).toContain('file-exists');
    expect(dynamic).toContain('command');
  });

  it('returns profile suffix for all 5 profiles', () => {
    const profiles = ['ops', 'research', 'curation', 'review', 'generic'] as const;
    for (const p of profiles) {
      const suffix = getProfileSuffix(p);
      expect(suffix.length).toBeGreaterThan(0);
      expect(suffix).toContain('Profile');
    }
  });
});
