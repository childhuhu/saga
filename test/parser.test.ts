/**
 * Unit tests for stage-spec parser (C2 — loose synonym normalization).
 */

import { describe, it, expect } from 'vitest';
import { parseDoneCriterion, parseDoneCriteria, parseStageSpec } from '../src/stage-spec/parser.js';

describe('parseDoneCriterion', () => {
  it('normalizes file-exists with path', () => {
    const result = parseDoneCriterion({ kind: 'file-exists', path: 'out/report.md' });
    expect(result.normalized.kind).toBe('file-exists');
    expect(result.normalized.path).toBe('out/report.md');
    expect(result.missing).toHaveLength(0);
  });

  it('normalizes file-exists with synonym minBytes → minSize', () => {
    const result = parseDoneCriterion({ kind: 'file-exists', path: 'report.md', minSize: 2000 });
    expect(result.normalized.minBytes).toBe(2000);
  });

  it('normalizes file-exists with synonym threshold', () => {
    const result = parseDoneCriterion({ kind: 'file-exists', path: 'report.md', threshold: 500 });
    expect(result.normalized.minBytes).toBe(500);
  });

  it('normalizes file-exists with synonym bytes', () => {
    const result = parseDoneCriterion({ kind: 'file-exists', path: 'report.md', bytes: 1000 });
    expect(result.normalized.minBytes).toBe(1000);
  });

  it('reports missing path for file-exists', () => {
    const result = parseDoneCriterion({ kind: 'file-exists' });
    expect(result.missing).toContain('path');
  });

  it('normalizes file-size-gt with path synonyms', () => {
    const result = parseDoneCriterion({ kind: 'file-size-gt', filePath: 'data.json', minBytes: 3000 });
    expect(result.normalized.path).toBe('data.json');
    expect(result.normalized.minBytes).toBe(3000);
  });

  it('reports missing minBytes for file-size-gt', () => {
    const result = parseDoneCriterion({ kind: 'file-size-gt', path: 'data.json' });
    expect(result.missing).toContain('minBytes');
  });

  it('normalizes command with cmd synonym', () => {
    const result = parseDoneCriterion({ kind: 'command', cmd: 'npm test' });
    expect(result.normalized.command).toBe('npm test');
  });

  it('reports missing command for command kind', () => {
    const result = parseDoneCriterion({ kind: 'command' });
    expect(result.missing).toContain('command');
  });

  it('handles free-form with desc synonym', () => {
    const result = parseDoneCriterion({ kind: 'free-form', description: 'report must be thorough' });
    expect(result.normalized.kind).toBe('free-form');
    expect(result.normalized.desc).toBe('report must be thorough');
  });

  it('preserves unknown kinds with all fields', () => {
    const result = parseDoneCriterion({ kind: 'custom-check', foo: 'bar', baz: 42 });
    expect(result.normalized.kind).toBe('custom-check');
    expect(result.normalized.foo).toBe('bar');
  });
});

describe('parseDoneCriteria', () => {
  it('parses an array of criteria', () => {
    const results = parseDoneCriteria([
      { kind: 'file-exists', path: 'a.md' },
      { kind: 'command', run: 'npm test' },
      'just a string',
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]!.normalized.kind).toBe('file-exists');
    expect(results[1]!.normalized.kind).toBe('command');
    expect(results[2]!.normalized.kind).toBe('free-form');
  });
});

describe('parseStageSpec', () => {
  it('parses a full stage spec with all fields', () => {
    const result = parseStageSpec({
      id: 'stage-01',
      title: 'Gather sources',
      goal: 'Find 5 sources on topic X',
      done: [
        { kind: 'file-exists', path: 'sources.md', minBytes: 2000 },
        { kind: 'free-form', desc: 'At least 5 sources listed' },
      ],
      evaluator: 'deep',
    }, 0);

    expect(result.id).toBe('stage-01');
    expect(result.title).toBe('Gather sources');
    expect(result.goal).toBe('Find 5 sources on topic X');
    expect(result.doneCriteria).toHaveLength(2);
    expect(result.evaluatorMode).toBe('deep');
    expect(result.missingFields).toHaveLength(0);
  });

  it('uses index-based id when id not provided', () => {
    const result = parseStageSpec({ goal: 'do stuff', done: [] }, 2);
    expect(result.id).toBe('stage-03');
  });

  it('normalizes title from name synonym', () => {
    const result = parseStageSpec({ name: 'My Stage', goal: 'x', done: [] }, 0);
    expect(result.title).toBe('My Stage');
  });

  it('normalizes goal from description synonym', () => {
    const result = parseStageSpec({ description: 'A description', done: [] }, 0);
    expect(result.goal).toBe('A description');
  });

  it('defaults evaluatorMode to auto', () => {
    const result = parseStageSpec({ goal: 'x', done: [] }, 0);
    expect(result.evaluatorMode).toBe('auto');
  });

  it('reports missing goal', () => {
    const result = parseStageSpec({ done: [] }, 0);
    expect(result.missingFields).toContain('stage-01: goal');
  });

  it('accepts done-criteria via doneCriteria key', () => {
    const result = parseStageSpec({
      goal: 'x',
      doneCriteria: [{ kind: 'file-exists', path: 'a.md' }],
    }, 0);
    expect(result.doneCriteria).toHaveLength(1);
  });

  it('accepts done-criteria via checks key', () => {
    const result = parseStageSpec({
      goal: 'x',
      checks: [{ kind: 'command', command: 'echo ok' }],
    }, 0);
    expect(result.doneCriteria).toHaveLength(1);
  });
});
