/**
 * Public API surface.
 */

export { advance, createSaga } from './coordinator/advance.js';
export type {
  SagaState,
  AdvanceInput,
  AdvanceResult,
  AdvanceDeps,
  Plan,
  Stage,
  Transition,
  EvaluatorMode,
  ProfileId,
  SagaEvent,
  DoneCriterion,
  EvalVerdict,
  HardCheckResult,
  RecoveryAttempts,
} from './coordinator/state.js';
export { currentStage, nextStage, initialSagaState } from './coordinator/state.js';
export type { Termination, TerminationReason } from './coordinator/transitions.js';
export { terminate } from './coordinator/transitions.js';
export { createSagaPlugin } from './adapters/openclaw-plugin.js';
export type { OpenClawPluginApi } from './adapters/openclaw-plugin.js';
