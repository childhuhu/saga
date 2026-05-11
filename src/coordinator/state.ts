/**
 * Saga state types — continue-site pattern, no enum state machine.
 *
 * The saga lifecycle is driven by a series of "continue sites" in advance(),
 * each inspecting `state.transition` to decide the next step.
 * State transitions are discriminated unions, not enum dispatches.
 */

import type { Termination } from './transitions.js';
import type { ProgressSummary } from './progress.js';

// ── Profile identifiers ──────────────────────────────────────────────
export type ProfileId = 'ops' | 'research' | 'curation' | 'review' | 'generic';

// ── Stage & Plan ─────────────────────────────────────────────────────
export type EvaluatorMode = 'auto' | 'deep';

export interface DoneCriterion {
  kind: string;
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  title: string;
  goal: string;
  doneCriteria: DoneCriterion[];
  evaluatorMode: EvaluatorMode;
}

export interface Plan {
  summary: string;
  stages: Stage[];
}

// ── Transition (continue-site marker) ────────────────────────────────
export type Transition =
  | { kind: 'plan_required' }
  | { kind: 'awaiting_plan_yaml' }
  | { kind: 'worker_mode_injected'; stageId: string }
  | { kind: 'eval_deep_pending'; stageId: string }
  | { kind: 'eval_passed'; stageId: string }
  | { kind: 'eval_needs_fix_attempt'; stageId: string; attempt: number; issues: string[] }
  | { kind: 'microcompact_retry'; stageId: string; issues: string[] }
  | { kind: 'rework_full'; stageId: string; attempt: number; issues: string[] }
  | { kind: 'awaiting_human'; reason: string }
  | { kind: 'clarifying_requirements'; questions: string[] };

// ── Recovery attempts ────────────────────────────────────────────────
export interface RecoveryAttempts {
  [stageId: string]: number;
}

// ── Core saga state ──────────────────────────────────────────────────
export interface SagaState {
  sagaId: string;
  profile: ProfileId;
  goal: string;
  plan: Plan | undefined;
  stages: Stage[];
  cursor: number;
  modeRevision: number;

  transition: Transition | undefined;
  recoveryAttempts: RecoveryAttempts;

  compactedEvalIds: string[];

  clarificationRound: number;
  clarificationHistory: Array<{ question: string; answer: string }>;
  clarificationLimit: number;

  termination: Termination | undefined;
}

// ── Advance I/O ──────────────────────────────────────────────────────
export interface WorkerDiagnostics {
  searchedTerms?: string[];
  urlsAttempted?: Array<{ url: string; status: number | string }>;
  errorsCaught?: string[];
  notes?: string;
}

export interface AdvanceInput {
  sagaId: string;
  /** Caller signals: the worker believes it has finished this stage */
  workerFinished?: boolean;
  /** Human-provided input after awaiting_human */
  humanInput?: string;
  /** Deep eval verdict submitted by the agent after eval_deep_required */
  evalResult?: EvalVerdict;
  /** Worker-submitted diagnostic information for root cause analysis */
  workerDiagnostics?: WorkerDiagnostics;
}

// nextAction is a string literal, not an enum — per C3
export type NextAction =
  | 'worker_mode_queued'
  | 'continue_worker_now'
  | 'revision_queued'
  | 'await_human'
  | 'terminated'
  | 'eval_deep_required'
  | 'clarification_needed';

export type AdvanceResult =
  | { nextAction: 'worker_mode_queued'; stageId: string; progress?: ProgressSummary }
  | { nextAction: 'continue_worker_now'; reason: string; progress?: ProgressSummary }
  | { nextAction: 'revision_queued'; stageId: string; reason: string; progress?: ProgressSummary }
  | { nextAction: 'await_human'; diagnostic: string; progress?: ProgressSummary }
  | { nextAction: 'terminated'; reason: string; details?: string; progress?: ProgressSummary }
  | { nextAction: 'eval_deep_required'; evalPrompt: string; stageId: string; progress?: ProgressSummary }
  | { nextAction: 'clarification_needed'; questions: string[]; round: number; limit: number; progress?: ProgressSummary };

// ── Dependency injection surface ─────────────────────────────────────
// advance() takes all external interactions as deps — testable without OpenClaw.

export interface PlanResult {
  plan: Plan;
}

export interface EvalVerdict {
  passed: boolean;
  issues: string[];
  score: number | null;
  /** true = criteria are structurally unachievable; pause for human decision instead of rework loop */
  escalate?: boolean;
}

export interface HardCheckResult {
  criterion: DoneCriterion;
  passed: boolean;
  detail: string;
}

export interface AdvanceDeps {
  readState(sagaId: string): Promise<SagaState>;
  writeState(state: SagaState): Promise<void>;
  appendEvent(sagaId: string, event: SagaEvent): Promise<void>;

  runPlanner(goal: string, profile: ProfileId): Promise<PlanResult>;
  runEvaluator(state: SagaState, stage: Stage): Promise<EvalVerdict>;
  runHardChecks(stage: Stage, state: SagaState): Promise<HardCheckResult[]>;
  buildDeepEvalPrompt(state: SagaState, stage: Stage): Promise<string>;

  queueWorkerModeInjection(state: SagaState, stage: Stage): Promise<void>;
  runClarifier(state: SagaState): Promise<{ questions: string[] } | { skip: true }>;
  readLatestDiagnostic?(sagaId: string, stageId: string): Promise<WorkerDiagnostics | undefined>;
}

// ── Saga events (append-only log) ────────────────────────────────────
export type SagaEvent =
  | { type: 'saga_created'; sagaId: string; profile: ProfileId; goal: string; ts: string }
  | { type: 'plan_produced'; sagaId: string; stageCount: number; stages: Stage[]; summary: string; ts: string }
  | { type: 'worker_mode_queued'; sagaId: string; stageId: string; modeRevision: number; ts: string }
  | { type: 'worker_finished'; sagaId: string; stageId: string; ts: string }
  | { type: 'eval_completed'; sagaId: string; stageId: string; passed: boolean; score: number | null; ts: string }
  | { type: 'eval_deep_required'; sagaId: string; stageId: string; ts: string }
  | { type: 'deep_eval_completed'; sagaId: string; stageId: string; passed: boolean; score: number | null; escalate?: boolean; ts: string }
  | { type: 'recovery_attempt'; sagaId: string; stageId: string; attempt: number; method: string; issues: string[]; ts: string }
  | { type: 'stage_advanced'; sagaId: string; fromStageId: string; toStageId: string | null; ts: string }
  | { type: 'saga_terminated'; sagaId: string; reason: string; details?: string; ts: string }
  | { type: 'cleanup'; sagaId: string; message: string; ts: string };

// ── Helpers ──────────────────────────────────────────────────────────
export function currentStage(state: SagaState): Stage | undefined {
  return state.stages[state.cursor] ?? undefined;
}

export function nextStage(state: SagaState): Stage | undefined {
  return state.stages[state.cursor + 1] ?? undefined;
}

export function initialSagaState(sagaId: string, profile: ProfileId, goal: string): SagaState {
  return {
    sagaId,
    profile,
    goal,
    plan: undefined,
    stages: [],
    cursor: 0,
    modeRevision: 0,
    transition: undefined,
    recoveryAttempts: {},
    compactedEvalIds: [],
    clarificationRound: 0,
    clarificationHistory: [],
    clarificationLimit: 3,
    termination: undefined,
  };
}
