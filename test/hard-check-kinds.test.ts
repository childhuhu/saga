/**
 * Unit tests for hard-check-kinds partition algorithm.
 */

import { describe, it, expect } from 'vitest';
import { partitionChecks, HARD_CHECK_TRAITS } from '../src/stage-spec/hard-check-kinds.js';

describe('HARD_CHECK_TRAITS', () => {
  it('marks command as write and non-concurrency-safe', () => {
    expect(HARD_CHECK_TRAITS['command'].isReadOnly).toBe(false);
    expect(HARD_CHECK_TRAITS['command'].isConcurrencySafe).toBe(false);
  });

  it('marks file-exists as readonly and safe', () => {
    expect(HARD_CHECK_TRAITS['file-exists'].isReadOnly).toBe(true);
    expect(HARD_CHECK_TRAITS['file-exists'].isConcurrencySafe).toBe(true);
  });

  it('marks browser as readonly but non-concurrency-safe', () => {
    expect(HARD_CHECK_TRAITS['browser'].isReadOnly).toBe(true);
    expect(HARD_CHECK_TRAITS['browser'].isConcurrencySafe).toBe(false);
  });
});

describe('partitionChecks', () => {
  it('separates readonly from write checks', () => {
    const checks = [
      { kind: 'file-exists', path: 'a.md' },
      { kind: 'command', command: 'npm test' },
      { kind: 'file-schema', path: 'data.json' },
      { kind: 'command', command: 'npm run build' },
      { kind: 'free-form', desc: 'quality' },
    ];

    const { readonly, write } = partitionChecks(checks);
    expect(readonly).toHaveLength(3); // file-exists, file-schema, free-form
    expect(write).toHaveLength(2); // command × 2
  });

  it('handles all-readonly', () => {
    const checks = [
      { kind: 'file-exists', path: 'a.md' },
      { kind: 'progress-items' },
    ];
    const { readonly, write } = partitionChecks(checks);
    expect(readonly).toHaveLength(2);
    expect(write).toHaveLength(0);
  });

  it('handles all-write', () => {
    const checks = [
      { kind: 'command', command: 'echo hi' },
      { kind: 'browser', url: 'http://test' },
    ];
    const { readonly, write } = partitionChecks(checks);
    expect(readonly).toHaveLength(1); // browser is readonly
    expect(write).toHaveLength(1); // command
  });
});
