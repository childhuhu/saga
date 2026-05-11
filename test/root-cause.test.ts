import { describe, it, expect } from 'vitest';
import { classifyRootCause } from '../src/recovery/classifiers.js';
import type { HardCheckResult, EvalVerdict, WorkerDiagnostics } from '../src/coordinator/state.js';

describe('classifyRootCause', () => {
  it('detects network_transient from timeout errors', () => {
    const diagnostics: WorkerDiagnostics = {
      errorsCaught: ['connection timeout after 30s', 'ECONNRESET'],
    };
    const result = classifyRootCause(undefined, [], diagnostics);
    expect(result.kind).toBe('network_transient');
    expect(result.retryStrategy).toBe('fix-attempt');
  });

  it('detects information_unavailable when urls all fail with size issue', () => {
    const diagnostics: WorkerDiagnostics = {
      searchedTerms: ['lithium safety', 'battery research'],
      urlsAttempted: [
        { url: 'https://example.com/a', status: 404 },
        { url: 'https://example.com/b', status: 'empty' },
      ],
    };
    const hardChecks: HardCheckResult[] = [
      { criterion: { kind: 'file-size-gt' }, passed: false, detail: '500 bytes, expected 1000' },
    ];
    const result = classifyRootCause(undefined, hardChecks, diagnostics);
    expect(result.kind).toBe('information_unavailable');
    expect(result.retryStrategy).toBe('awaiting_human');
    expect(result.userMessage).toContain('lithium safety');
  });

  it('returns quality_insufficient as default', () => {
    const verdict: EvalVerdict = { passed: false, issues: ['poor structure'], score: 0.3 };
    const result = classifyRootCause(verdict, [], undefined);
    expect(result.kind).toBe('quality_insufficient');
    expect(result.retryStrategy).toBe('fix-attempt');
    expect(result.userMessage).toContain('poor structure');
  });

  it('returns quality_insufficient when no diagnostics provided', () => {
    const result = classifyRootCause(undefined, [], undefined);
    expect(result.kind).toBe('quality_insufficient');
  });

  it('does not trigger information_unavailable without size issue', () => {
    const diagnostics: WorkerDiagnostics = {
      searchedTerms: ['test'],
      urlsAttempted: [{ url: 'https://example.com', status: 404 }],
    };
    const result = classifyRootCause(undefined, [], diagnostics);
    expect(result.kind).toBe('quality_insufficient');
  });
});
