/**
 * Continue-site helpers for the advance dispatcher.
 *
 * Each function corresponds to one continue-site in the dispatch loop.
 * Adding a new recovery path = adding a new function here + one `if` in advance().
 */

import type { SagaState, Stage, AdvanceResult, Transition, RecoveryAttempts } from './state.js';

// ── Termination reasons (no "blocked" state) ──────────────────────────

export type TerminationReason =
  | 'completed' | 'aborted_by_user' | 'plan_rejected'
  | 'worker_unrecoverable' | 'source_unavailable' | 'model_capability_exceeded'
  | 'budget_exceeded' | 'external_check_failed' | 'human_input_required' | 'internal_error';

export interface Termination { reason: TerminationReason; details: string; ts: string }

export function terminate(reason: TerminationReason, details: string): Termination {
  return { reason, details, ts: new Date().toISOString() };
}

// ── Transition helpers ────────────────────────────────────────────────

export function advanceCursor(state: SagaState, stageId: string): SagaState {
  return { ...state, cursor: state.cursor + 1, transition: { kind: 'eval_passed', stageId } };
}

export function allStagesDone(state: SagaState): boolean {
  return state.cursor >= state.stages.length;
}

export function terminatedResult(t: Termination): AdvanceResult {
  return { nextAction: 'terminated', reason: t.reason, details: t.details };
}

export function applyPlan(state: SagaState, plan: { summary: string; stages: Stage[] }): SagaState {
  return { ...state, plan, stages: plan.stages, cursor: 0, transition: undefined };
}

export function bumpRecovery(state: SagaState, stageId: string): SagaState {
  const attempts: RecoveryAttempts = { ...state.recoveryAttempts };
  attempts[stageId] = (attempts[stageId] ?? 0) + 1;
  return { ...state, recoveryAttempts: attempts };
}

export const MAX_RECOVERY_ATTEMPTS = 4;
