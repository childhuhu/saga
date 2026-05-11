/**
 * Saga advance dispatcher — continue-site loop.
 * Each `if` block is a continue-site. No enum, no switch.
 */

import type { SagaState, AdvanceInput, AdvanceResult, AdvanceDeps, SagaEvent, Stage, EvalVerdict, RecoveryAttempts, Transition } from './state.js';
import { currentStage, initialSagaState } from './state.js';
import { terminate, advanceCursor, allStagesDone, terminatedResult, applyPlan } from './transitions.js';
import type { TerminationReason } from './transitions.js';
import { classifyRecovery, applyRecovery } from '../recovery/cascading-chain.js';
import { classifyHardCheckFailure, classifyEvalFailure, classifyRootCause } from '../recovery/classifiers.js';
import { getProfile } from '../profiles/index.js';

function ts(): string {
  return new Date().toISOString();
}

// ── Shared helpers ─────────────────────────────────────────────────────

async function terminateAndPersist(
  state: SagaState,
  sagaId: string,
  reason: TerminationReason,
  details: string,
  deps: AdvanceDeps,
  opts?: { emitEvent?: boolean },
): Promise<{ state: SagaState; result: AdvanceResult }> {
  const termination = terminate(reason, details);
  state = { ...state, termination };
  await deps.writeState(state);
  if (opts?.emitEvent !== false) {
    await deps.appendEvent(sagaId, {
      type: 'saga_terminated',
      sagaId,
      reason: termination.reason,
      details: termination.details,
      ts: ts(),
    });
  }
  return { state, result: terminatedResult(termination) };
}

/** Advance cursor, check completion, queue next worker. */
async function advanceAfterPass(
  state: SagaState,
  sagaId: string,
  stageId: string,
  score: number | null,
  deps: AdvanceDeps,
): Promise<{ state: SagaState; result: AdvanceResult }> {
  state = advanceCursor(state, stageId);
  await deps.appendEvent(sagaId, {
    type: 'eval_completed',
    sagaId,
    stageId,
    passed: true,
    score,
    ts: ts(),
  });

  if (allStagesDone(state)) {
    return terminateAndPersist(state, sagaId, 'completed', `All ${state.stages.length} stages passed`, deps);
  }

  const next = currentStage(state)!;
  state = await queueWorkerAndEmit(state, sagaId, next, deps);
  await deps.appendEvent(sagaId, {
    type: 'stage_advanced',
    sagaId,
    fromStageId: stageId,
    toStageId: next.id,
    ts: ts(),
  });
  return { state, result: { nextAction: 'worker_mode_queued', stageId: next.id } };
}

/** Queue worker injection + emit event. */
async function queueWorkerAndEmit(
  state: SagaState,
  sagaId: string,
  stage: Stage,
  deps: AdvanceDeps,
): Promise<SagaState> {
  await deps.queueWorkerModeInjection(state, stage);
  state = {
    ...state,
    modeRevision: state.modeRevision + 1,
    transition: { kind: 'worker_mode_injected', stageId: stage.id },
  };
  await deps.writeState(state);
  await deps.appendEvent(sagaId, {
    type: 'worker_mode_queued',
    sagaId,
    stageId: stage.id,
    modeRevision: state.modeRevision,
    ts: ts(),
  });
  return state;
}

/** Recoverable failure via cascading chain. */
async function handleRecovery(
  state: SagaState,
  sagaId: string,
  stage: Stage,
  issues: string[],
  deps: AdvanceDeps,
): Promise<{ state: SagaState; result: AdvanceResult }> {
  const diagnostics = await deps.readLatestDiagnostic?.(sagaId, stage.id);
  const rootCause = classifyRootCause(undefined, [], diagnostics);

  if (rootCause.retryStrategy === 'awaiting_human') {
    state = { ...state, transition: { kind: 'awaiting_human', reason: rootCause.userMessage } };
    await deps.writeState(state);
    return { state, result: { nextAction: 'await_human', diagnostic: rootCause.userMessage } };
  }
  if (rootCause.retryStrategy === 'terminal') {
    return terminateAndPersist(state, sagaId, rootCause.terminalReason ?? 'worker_unrecoverable', rootCause.userMessage, deps);
  }

  const decision = classifyRecovery(state, stage.id, issues);
  state = applyRecovery(state, decision);
  await deps.writeState(state);
  await deps.appendEvent(sagaId, {
    type: 'recovery_attempt',
    sagaId,
    stageId: stage.id,
    attempt: (state.recoveryAttempts[stage.id] ?? 0),
    method: decision.method,
    issues,
    ts: ts(),
  });

  if (decision.nextAction === 'worker_mode_queued') {
    await deps.queueWorkerModeInjection(state, stage);
    state = { ...state, modeRevision: state.modeRevision + 1 };
    await deps.writeState(state);
    return { state, result: { nextAction: 'worker_mode_queued', stageId: stage.id } };
  }
  if (decision.nextAction === 'terminated') {
    return terminateAndPersist(state, sagaId, 'worker_unrecoverable', decision.diagnostic, deps);
  }
  if (decision.nextAction === 'await_human') {
    return { state, result: { nextAction: 'await_human', diagnostic: decision.diagnostic } };
  }
  return { state, result: { nextAction: 'revision_queued', stageId: stage.id, reason: decision.diagnostic } };
}

// ── Create saga ────────────────────────────────────────────────────────

export async function createSaga(
  sagaId: string,
  profile: SagaState['profile'],
  goal: string,
  deps: AdvanceDeps,
): Promise<SagaState> {
  const profileDef = getProfile(profile);
  const state = {
    ...initialSagaState(sagaId, profile, goal),
    clarificationLimit: profileDef.defaultClarificationRounds,
  };
  await deps.writeState(state);
  await deps.appendEvent(sagaId, {
    type: 'saga_created',
    sagaId,
    profile,
    goal,
    ts: ts(),
  });
  return state;
}

// ── Main dispatch ──────────────────────────────────────────────────────

export async function advance(
  input: AdvanceInput,
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  let state = await deps.readState(input.sagaId);

  if (state.termination !== undefined) {
    return terminatedResult(state.termination);
  }

  // Continue-site 0: clarification phase
  if (state.clarificationLimit > 0 && state.clarificationRound < state.clarificationLimit && state.plan === undefined) {
    if (input.humanInput !== undefined) {
      const prevQuestions = state.transition?.kind === 'clarifying_requirements'
        ? (state.transition as { kind: 'clarifying_requirements'; questions: string[] }).questions.join('\n')
        : '';
      state = {
        ...state,
        clarificationHistory: [
          ...state.clarificationHistory,
          { question: prevQuestions, answer: input.humanInput },
        ],
        clarificationRound: state.clarificationRound + 1,
      };
      if (/够了|不用问了|skip|enough|no more/i.test(input.humanInput) || state.clarificationRound >= state.clarificationLimit) {
        state = { ...state, transition: undefined };
        await deps.writeState(state);
      } else {
        const next = await deps.runClarifier(state);
        if ('skip' in next || next.questions.length === 0) {
          state = { ...state, transition: undefined };
          await deps.writeState(state);
        } else {
          state = { ...state, transition: { kind: 'clarifying_requirements', questions: next.questions } };
          await deps.writeState(state);
          return { nextAction: 'clarification_needed', questions: next.questions, round: state.clarificationRound, limit: state.clarificationLimit };
        }
      }
    } else if (state.transition?.kind !== 'clarifying_requirements') {
      const result = await deps.runClarifier(state);
      if ('skip' in result || result.questions.length === 0) {
        state = { ...state, transition: undefined };
        await deps.writeState(state);
      } else {
        state = { ...state, transition: { kind: 'clarifying_requirements', questions: result.questions } };
        await deps.writeState(state);
        return { nextAction: 'clarification_needed', questions: result.questions, round: 0, limit: state.clarificationLimit };
      }
    } else {
      const t = state.transition as { kind: 'clarifying_requirements'; questions: string[] };
      return { nextAction: 'clarification_needed', questions: t.questions, round: state.clarificationRound, limit: state.clarificationLimit };
    }
  }

  // Continue-site 1: No plan yet — run planner
  if (state.plan === undefined) {
    const enrichedGoal = state.clarificationHistory.length > 0
      ? `${state.goal}\n\nClarifications:\n${state.clarificationHistory.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n')}`
      : state.goal;
    const planResult = await deps.runPlanner(enrichedGoal, state.profile);

    if (planResult.plan.stages.length === 0) {
      state = { ...state, transition: { kind: 'awaiting_plan_yaml' } };
      await deps.writeState(state);
      return { nextAction: 'await_human', diagnostic: `Generate a plan for: "${state.goal}". Break into stages with YAML done-criteria, then call saga_advance with planYaml=<your plan>.` };
    }

    state = applyPlan(state, planResult.plan);
    state = { ...state, transition: { kind: 'plan_required' } };
    await deps.writeState(state);
    await deps.appendEvent(input.sagaId, {
      type: 'plan_produced',
      sagaId: input.sagaId,
      stageCount: planResult.plan.stages.length,
      stages: planResult.plan.stages,
      summary: planResult.plan.summary,
      ts: ts(),
    });

    const firstStage = planResult.plan.stages[0]!;
    state = await queueWorkerAndEmit(state, input.sagaId, firstStage, deps);
    return { nextAction: 'worker_mode_queued', stageId: firstStage.id };
  }

  // Continue-site 1b: Plan exists but no transition — start first stage
  if (state.plan !== undefined && state.transition === undefined && state.stages.length > 0) {
    const firstStage = state.stages[0]!;
    state = await queueWorkerAndEmit(state, input.sagaId, firstStage, deps);
    return { nextAction: 'worker_mode_queued', stageId: firstStage.id };
  }

  // Continue-site 2: Worker finished — run evaluation
  if (input.workerFinished) {
    const stage = currentStage(state);
    if (stage === undefined) {
      const r = await terminateAndPersist(state, input.sagaId, 'completed', 'All stages processed', deps, { emitEvent: false });
      return r.result;
    }

    // Hard checks
    const hardCheckResults = await deps.runHardChecks(stage, state);
    const allHardPassed = hardCheckResults.every((r) => r.passed);

    if (!allHardPassed) {
      const issues = hardCheckResults.filter((r) => !r.passed).map((r) => r.detail);
      const classified = classifyHardCheckFailure(hardCheckResults);

      if (classified.category === 'terminal') {
        const r = await terminateAndPersist(state, input.sagaId, classified.terminalReason ?? 'worker_unrecoverable', classified.recoveryHint, deps);
        return r.result;
      }

      const r = await handleRecovery(state, input.sagaId, stage, issues, deps);
      state = r.state;
      return r.result;
    }

    // Hard checks passed — check evaluator mode
    if (stage.evaluatorMode === 'deep') {
      state = { ...state, transition: { kind: 'eval_deep_pending', stageId: stage.id } };
      await deps.writeState(state);
      await deps.appendEvent(input.sagaId, {
        type: 'eval_deep_required',
        sagaId: input.sagaId,
        stageId: stage.id,
        ts: ts(),
      });
      const evalPrompt = await deps.buildDeepEvalPrompt(state, stage);
      return { nextAction: 'eval_deep_required', evalPrompt, stageId: stage.id };
    }

    // Auto mode: run evaluator
    const verdict = await deps.runEvaluator(state, stage);

    if (!verdict.passed) {
      const classified = classifyEvalFailure(verdict);
      if (classified.category === 'terminal') {
        const r = await terminateAndPersist(state, input.sagaId, classified.terminalReason ?? 'worker_unrecoverable', classified.recoveryHint, deps);
        return r.result;
      }
      const r = await handleRecovery(state, input.sagaId, stage, verdict.issues, deps);
      state = r.state;
      return r.result;
    }

    // Eval passed — advance cursor
    const r = await advanceAfterPass(state, input.sagaId, stage.id, verdict.score, deps);
    return r.result;
  }

  // Continue-site 2b: Deep eval verdict submitted
  if (state.transition?.kind === 'eval_deep_pending' && input.evalResult) {
    const stageId = state.transition.stageId;
    const stage = state.stages.find((s) => s.id === stageId);
    if (!stage) {
      const r = await terminateAndPersist(state, input.sagaId, 'internal_error', `Stage ${stageId} not found during deep eval`, deps, { emitEvent: false });
      return r.result;
    }

    const verdict: EvalVerdict = {
      passed: input.evalResult.passed,
      score: input.evalResult.score ?? null,
      issues: input.evalResult.issues ?? [],
      escalate: input.evalResult.escalate ?? false,
    };

    await deps.appendEvent(input.sagaId, {
      type: 'deep_eval_completed',
      sagaId: input.sagaId,
      stageId,
      passed: verdict.passed,
      score: verdict.score,
      escalate: verdict.escalate,
      ts: ts(),
    });

    if (verdict.passed) {
      const r = await advanceAfterPass(state, input.sagaId, stageId, verdict.score, deps);
      return r.result;
    }

    // Evaluator flagged criteria as structurally unachievable → escalate to human.
    // This breaks the rework loop when the problem is the criteria, not the execution.
    if (verdict.escalate) {
      const reason = verdict.issues.length > 0
        ? `Deep eval: criteria unachievable — ${verdict.issues.join('; ')}`
        : 'Deep eval: criteria cannot be met with available information';
      state = { ...state, transition: { kind: 'awaiting_human', reason } };
      await deps.writeState(state);
      return {
        nextAction: 'await_human',
        diagnostic: `⚠️ 验收标准无法达成，需要你来决定下一步：\n\n${reason}\n\n选项：\n1. 放弃任务：调用 saga_cancel\n2. 放松标准后继续：告诉我放松哪些条件，我调用 saga_advance(humanInput="放松条件：...") 重新评估`,
      };
    }

    // Deep eval failed but criteria are achievable — enter recovery chain
    const r = await handleRecovery(state, input.sagaId, stage, verdict.issues, deps);
    state = r.state;
    return r.result;
  }

  // Continue-site 3: Revision needed
  if (state.transition?.kind === 'eval_needs_fix_attempt') {
    const t = state.transition;
    const stage = state.stages.find((s) => s.id === t.stageId);
    if (stage) {
      return { nextAction: 'revision_queued', stageId: stage.id, reason: `Retry attempt ${t.attempt} — previous output did not meet criteria` };
    }
  }

  // Continue-site 3b: Microcompact retry
  if (state.transition?.kind === 'microcompact_retry') {
    const t = state.transition;
    const stage = state.stages.find((s) => s.id === t.stageId);
    if (stage) {
      state = await queueWorkerAndEmit(state, input.sagaId, stage, deps);
      return { nextAction: 'worker_mode_queued', stageId: stage.id };
    }
  }

  // Continue-site 3c: Full rework
  if (state.transition?.kind === 'rework_full') {
    const t = state.transition;
    const stage = state.stages.find((s) => s.id === t.stageId);
    if (stage) {
      state = await queueWorkerAndEmit(state, input.sagaId, stage, deps);
      return { nextAction: 'worker_mode_queued', stageId: stage.id };
    }
  }

  // Continue-site 4: Awaiting human input
  if (state.transition?.kind === 'awaiting_human') {
    if (input.humanInput) {
      const stage = currentStage(state);
      if (stage) {
        state = await queueWorkerAndEmit(state, input.sagaId, stage, deps);
        return { nextAction: 'worker_mode_queued', stageId: stage.id };
      }
    }
    return { nextAction: 'await_human', diagnostic: state.transition.reason };
  }

  // Default: worker mode active
  if (state.transition?.kind === 'worker_mode_injected') {
    return { nextAction: 'continue_worker_now', reason: `Worker mode active for stage ${state.transition.stageId}` };
  }

  // Defensive: unhandled state
  const r = await terminateAndPersist(state, input.sagaId, 'internal_error', `Unhandled state: transition=${JSON.stringify(state.transition)}, plan=${state.plan ? 'present' : 'absent'}`, deps, { emitEvent: false });
  return r.result;
}

// ── Resume support ─────────────────────────────────────────────────────

export async function resumeSaga(
  sagaId: string,
  deps: AdvanceDeps & { readEvents(sagaId: string): Promise<SagaEvent[]> },
): Promise<{ state: SagaState; result: AdvanceResult }> {
  let state: SagaState;
  try {
    state = await deps.readState(sagaId);
  } catch {
    state = await reconstructFromEvents(sagaId, deps.readEvents);
    await deps.writeState(state);
  }

  if (state.termination) {
    return { state, result: terminatedResult(state.termination) };
  }
  if (state.transition?.kind === 'awaiting_human') {
    return { state, result: { nextAction: 'await_human', diagnostic: state.transition.reason } };
  }

  const result = await advance({ sagaId }, deps);
  return { state, result };
}

async function reconstructFromEvents(
  sagaId: string,
  readEvents: (sagaId: string) => Promise<SagaEvent[]>,
): Promise<SagaState> {
  const events = await readEvents(sagaId);
  let state: SagaState = initialSagaState(sagaId, 'research', '(reconstructed)');

  for (const event of events) {
    switch (event.type) {
      case 'saga_created':
        state = { ...state, profile: event.profile, goal: event.goal };
        break;
      case 'plan_produced':
        if (event.stages && Array.isArray(event.stages)) {
          state = applyPlan(state, { summary: event.summary ?? '', stages: event.stages });
        }
        break;
      case 'worker_mode_queued':
        state = {
          ...state,
          modeRevision: event.modeRevision,
          transition: { kind: 'worker_mode_injected', stageId: event.stageId },
        };
        break;
      case 'eval_completed':
        if (event.passed) {
          state = advanceCursor(state, event.stageId);
        }
        break;
      case 'eval_deep_required':
        state = { ...state, transition: { kind: 'eval_deep_pending', stageId: event.stageId } };
        break;
      case 'deep_eval_completed':
        if (event.passed) state = advanceCursor(state, event.stageId);
        break;
      case 'stage_advanced':
        break;
      case 'recovery_attempt': {
        const attempts: RecoveryAttempts = { ...state.recoveryAttempts };
        attempts[event.stageId] = event.attempt;
        const issues = event.issues ?? [];
        let transition: Transition;
        if (event.method === 'fix-attempt') transition = { kind: 'eval_needs_fix_attempt', stageId: event.stageId, attempt: event.attempt, issues };
        else if (event.method === 'microcompact-retry') transition = { kind: 'microcompact_retry', stageId: event.stageId, issues };
        else if (event.method === 'full-rework') transition = { kind: 'rework_full', stageId: event.stageId, attempt: event.attempt, issues };
        else transition = { kind: 'eval_needs_fix_attempt', stageId: event.stageId, attempt: event.attempt, issues };
        state = { ...state, recoveryAttempts: attempts, transition };
        break;
      }
      case 'saga_terminated':
        state = { ...state, termination: terminate(event.reason as TerminationReason, event.details ?? '') };
        break;
    }
  }
  return state;
}
