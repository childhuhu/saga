/**
 * Unit tests for recovery classifiers and cascading chain.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyHardCheckFailure,
  classifyEvalFailure,
  classifyRuntimeError,
} from '../src/recovery/classifiers.js';
import {
  classifyRecovery,
  applyRecovery,
} from '../src/recovery/cascading-chain.js';
import type { SagaState, HardCheckResult, EvalVerdict } from '../src/coordinator/state.js';
import { initialSagaState } from '../src/coordinator/state.js';

function makeState(overrides?: Partial<SagaState>): SagaState {
  return { ...initialSagaState('test', 'research', 'test goal'), ...overrides };
}

describe('classifyHardCheckFailure', () => {
  it('detects source_unavailable from 403', () => {
    const results: HardCheckResult[] = [
      { criterion: { kind: 'command' }, passed: false, detail: 'command returned 403 Forbidden' },
    ];
    const classified = classifyHardCheckFailure(results);
    expect(classified.category).toBe('terminal');
    expect(classified.terminalReason).toBe('source_unavailable');
  });

  it('detects source_unavailable from login required', () => {
    const results: HardCheckResult[] = [
      { criterion: { kind: 'command' }, passed: false, detail: 'Login required to access resource' },
    ];
    const classified = classifyHardCheckFailure(results);
    expect(classified.category).toBe('terminal');
    expect(classified.terminalReason).toBe('source_unavailable');
  });

  it('classifies regular failures as recoverable', () => {
    const results: HardCheckResult[] = [
      { criterion: { kind: 'file-exists', path: 'a.md' }, passed: false, detail: 'file not found: a.md' },
    ];
    const classified = classifyHardCheckFailure(results);
    expect(classified.category).toBe('recoverable');
  });
});

describe('classifyEvalFailure', () => {
  it('detects model_capability_exceeded', () => {
    const verdict: EvalVerdict = {
      passed: false,
      issues: ['Output context length exceeded, cannot process further'],
      score: null,
    };
    const classified = classifyEvalFailure(verdict);
    expect(classified.category).toBe('terminal');
    expect(classified.terminalReason).toBe('model_capability_exceeded');
  });

  it('classifies regular eval issues as recoverable', () => {
    const verdict: EvalVerdict = {
      passed: false,
      issues: ['Missing 2 sources', 'Poor structure'],
      score: 2.8,
    };
    const classified = classifyEvalFailure(verdict);
    expect(classified.category).toBe('recoverable');
  });
});

describe('classifyRuntimeError', () => {
  it('detects plan_rejected', () => {
    const classified = classifyRuntimeError(new Error('Planner unable to produce valid plan'));
    expect(classified.category).toBe('terminal');
    expect(classified.terminalReason).toBe('plan_rejected');
  });

  it('classifies generic errors as recoverable', () => {
    const classified = classifyRuntimeError(new Error('network timeout'));
    expect(classified.category).toBe('recoverable');
  });
});

describe('classifyRecovery', () => {
  it('returns fix-attempt for attempts 0 and 1', () => {
    const state = makeState({ recoveryAttempts: {} });
    const decision = classifyRecovery(state, 'stage-01', ['file missing']);
    expect(decision.method).toBe('fix-attempt');
    expect(decision.layer).toBe(0);
    expect(decision.nextAction).toBe('revision_queued');
  });

  it('returns fix-attempt with issues', () => {
    const state = makeState({ recoveryAttempts: {} });
    const decision = classifyRecovery(state, 'stage-01', ['issue A', 'issue B']);
    expect(decision.transition).toMatchObject({ kind: 'eval_needs_fix_attempt', issues: ['issue A', 'issue B'] });
  });

  it('returns fix-attempt for attempt 1', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 1 } });
    const decision = classifyRecovery(state, 'stage-01', ['still missing']);
    expect(decision.method).toBe('fix-attempt');
    expect(decision.layer).toBe(1);
  });

  it('returns microcompact-retry for attempt 2', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 2 } });
    const decision = classifyRecovery(state, 'stage-01', ['persistent issue']);
    expect(decision.method).toBe('microcompact-retry');
    expect(decision.layer).toBe(2);
  });

  it('returns full-rework for attempt 3 (last chance)', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 3 } });
    const decision = classifyRecovery(state, 'stage-01', ['still failing']);
    expect(decision.method).toBe('full-rework');
    expect(decision.nextAction).toBe('worker_mode_queued');
  });

  it('returns terminal for attempts beyond max', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 4 } });
    const decision = classifyRecovery(state, 'stage-01', ['exhausted']);
    expect(decision.method).toBe('terminal');
    expect(decision.nextAction).toBe('terminated');
  });

  it('terminal decision has undefined transition', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 4 } });
    const decision = classifyRecovery(state, 'stage-01', ['exhausted']);
    expect(decision.method).toBe('terminal');
    expect(decision.transition).toBeUndefined();
  });
});

describe('applyRecovery', () => {
  it('bumps recovery attempts and sets transition', () => {
    const state = makeState({ recoveryAttempts: {} });
    const decision = classifyRecovery(state, 'stage-01', ['test']);
    const updated = applyRecovery(state, decision);
    expect(updated.recoveryAttempts['stage-01']).toBe(1);
    expect(updated.transition).toBeDefined();
  });

  it('does not mutate state on terminal', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 4 } });
    const decision = classifyRecovery(state, 'stage-01', ['exhausted']);
    const updated = applyRecovery(state, decision);
    expect(updated).toBe(state);
  });

  it('does not pollute recoveryAttempts with empty key', () => {
    const state = makeState({ recoveryAttempts: { 'stage-01': 4 } });
    const decision = classifyRecovery(state, 'stage-01', ['exhausted']);
    const updated = applyRecovery(state, decision);
    expect(Object.keys(updated.recoveryAttempts)).not.toContain('');
  });
});
