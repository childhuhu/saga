/**
 * Cascading recovery chain (§4.4, C6).
 *
 * Layer 0–1: fix-attempt (inject evaluator issues into next worker turn)
 * Layer 2:   microcompact + reenter worker mode
 * Layer 3:   full rework (reset stage to pending)
 * Terminal:   worker_unrecoverable
 *
 * Each layer is a function that returns the next state + nextAction.
 * The advance() dispatcher calls the appropriate layer based on recoveryAttempts.
 */

import type {
  SagaState,
  Transition,
  RecoveryAttempts,
} from '../coordinator/state.js';
import { MAX_RECOVERY_ATTEMPTS } from '../coordinator/transitions.js';

export interface RecoveryDecision {
  layer: number;
  method: 'fix-attempt' | 'microcompact-retry' | 'full-rework' | 'escalate-human' | 'terminal';
  transition: Transition | undefined;
  nextAction: 'revision_queued' | 'worker_mode_queued' | 'await_human' | 'terminated';
  diagnostic: string;
}

/**
 * Decide which recovery layer to apply based on attempt count.
 *
 * attempt 0–1: fix-attempt (cheapest — just re-inject with issues)
 * attempt 2:   microcompact + reenter
 * attempt 3:   full rework
 * beyond:      terminal
 */
export function classifyRecovery(state: SagaState, stageId: string, issues: string[]): RecoveryDecision {
  const attempts = state.recoveryAttempts[stageId] ?? 0;
  const issueSummary = issues.slice(0, 3).join('; ');

  if (attempts < 2) {
    return {
      layer: attempts,
      method: 'fix-attempt',
      transition: { kind: 'eval_needs_fix_attempt', stageId, attempt: attempts + 1, issues },
      nextAction: 'revision_queued',
      diagnostic: `fix-attempt ${attempts + 1}: ${issueSummary}`,
    };
  }

  if (attempts === 2) {
    return {
      layer: 2,
      method: 'microcompact-retry',
      transition: { kind: 'microcompact_retry', stageId, issues },
      nextAction: 'revision_queued',
      diagnostic: `microcompact-retry: clearing old eval context, re-entering worker mode. Issues: ${issueSummary}`,
    };
  }

  if (attempts < MAX_RECOVERY_ATTEMPTS) {
    return {
      layer: 3,
      method: 'full-rework',
      transition: { kind: 'rework_full', stageId, attempt: attempts + 1, issues },
      nextAction: 'worker_mode_queued',
      diagnostic: `full-rework ${attempts + 1}: resetting stage. Issues: ${issueSummary}`,
    };
  }

  return {
    layer: attempts,
    method: 'terminal',
    transition: undefined,
    nextAction: 'terminated',
    diagnostic: `All ${MAX_RECOVERY_ATTEMPTS} recovery layers exhausted: ${issueSummary}`,
  };
}

/**
 * Apply a recovery decision to state.
 * Returns new state with updated recoveryAttempts and transition.
 */
export function applyRecovery(state: SagaState, decision: RecoveryDecision): SagaState {
  if (decision.method === 'terminal' || decision.transition === undefined) {
    return state;
  }
  const transition = decision.transition;
  if (!('stageId' in transition)) {
    return { ...state, transition };
  }
  const stageId = transition.stageId;
  const attempts: RecoveryAttempts = { ...state.recoveryAttempts };
  attempts[stageId] = (attempts[stageId] ?? 0) + 1;
  return {
    ...state,
    recoveryAttempts: attempts,
    transition,
  };
}
