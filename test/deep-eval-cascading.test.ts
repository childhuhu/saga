/**
 * Deep eval cascading recovery test.
 *
 * Verifies that deep-eval failures go through handleRecovery
 * (cascading chain) instead of inline recovery logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance } from '../src/coordinator/advance.js';
import type { AdvanceDeps, SagaState, Stage, Plan, SagaEvent, HardCheckResult } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent, readEvents } from '../src/storage/events.js';
import { writeArtifact } from '../src/storage/artifact-store.js';
import { runDoneChecks } from '../src/stage-spec/done-criteria.js';
import { buildDeepEvalPrompt } from '../src/roles/evaluator-deep.js';
import { getProfile } from '../src/profiles/index.js';
import type { EvalChecklistType } from '../src/profiles/checklist-schema.js';
import { MAX_RECOVERY_ATTEMPTS } from '../src/coordinator/transitions.js';

const STUB_CHECKLIST: EvalChecklistType = {
  hard: [
    { id: 'H1', title: 'Test H1', passDescription: 'pass', failReworkDescription: 'rework', failEscalateDescription: 'escalate' },
    { id: 'H2', title: 'Test H2', passDescription: 'pass', failReworkDescription: 'rework', failEscalateDescription: 'escalate' },
    { id: 'H3', title: 'Test H3', passDescription: 'pass', failReworkDescription: 'rework', failEscalateDescription: 'escalate' },
  ],
  soft: [
    { id: 'S1', title: 'Test S1', weight: 0.4, scoringGuide: '5=best; 1=worst' },
    { id: 'S2', title: 'Test S2', weight: 0.3, scoringGuide: '5=best; 1=worst' },
    { id: 'S3', title: 'Test S3', weight: 0.2, scoringGuide: '5=best; 1=worst' },
    { id: 'S4', title: 'Test S4', weight: 0.1, scoringGuide: '5=best; 1=worst' },
  ],
};

function makeDeepEvalStage(id: string, title: string): Stage {
  return {
    id,
    title,
    goal: `Complete ${title}`,
    doneCriteria: [
      { kind: 'file-exists', path: `stages/${id}-report.md` },
      { kind: 'free-form', desc: 'Quality assessment' },
    ],
    evaluatorMode: 'deep',
  };
}

function makeDeps(stateRoot: string): AdvanceDeps {
  const plan: Plan = {
    summary: 'Deep eval cascading test plan',
    stages: [makeDeepEvalStage('stage-01', 'Research')],
  };

  return {
    async readState(sagaId: string) { return readState(stateRoot, sagaId); },
    async writeState(state: SagaState) { await writeState(stateRoot, state); },
    async appendEvent(sagaId: string, event: SagaEvent) { await appendEvent(stateRoot, sagaId, event); },
    async runPlanner() { return { plan }; },
    async runEvaluator() { return { passed: true, issues: [], score: null }; },
    async runHardChecks(stage: Stage, state: SagaState): Promise<HardCheckResult[]> {
      return runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
    },
    async buildDeepEvalPrompt(state: SagaState, stage: Stage): Promise<string> {
      return buildDeepEvalPrompt({
        stageId: stage.id,
        stageTitle: stage.title,
        stageGoal: stage.goal,
        doneCriteriaText: stage.doneCriteria.map(c => c.kind).join(', '),
        artifactContent: '(test artifact)',
        profile: getProfile(state.profile),
        fewShotExamples: '',
        checklist: STUB_CHECKLIST,
      });
    },
    async queueWorkerModeInjection() {},
    async runClarifier() { return { skip: true as const }; },
  };
}

describe('deep eval cascading recovery', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-deep-cascade-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('deep-eval fail goes through fix-attempt (layer 0)', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'deep-cascade-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Deep cascade test', deps);
    await advance({ sagaId }, deps);

    // Worker finishes
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    const r1 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r1.nextAction).toBe('eval_deep_required');

    // Deep eval fail — first failure should be fix-attempt
    const r2 = await advance({
      sagaId,
      evalResult: { passed: false, score: 2.0, issues: ['needs more depth'] },
    }, deps);
    expect(r2.nextAction).toBe('revision_queued');

    const state = await readState(tmpDir, sagaId);
    expect(state.recoveryAttempts['stage-01']).toBe(1);
    expect(state.transition?.kind).toBe('eval_needs_fix_attempt');
    if (state.transition?.kind === 'eval_needs_fix_attempt') {
      expect(state.transition.issues).toContain('needs more depth');
    }
  });

  it('deep-eval fail exhausts recovery layers and terminates', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'deep-cascade-002';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Exhaust recovery', deps);
    await advance({ sagaId }, deps);

    // Worker finishes → eval_deep_required
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);

    // Exhaust all recovery layers:
    // Layer 0: fix-attempt (recoveryAttempts=0 → 1)
    // Layer 1: fix-attempt (recoveryAttempts=1 → 2)
    // Layer 2: microcompact-retry (recoveryAttempts=2 → 3)
    // Layer 3: full-rework (recoveryAttempts=3 → 4)
    // Beyond max: terminal

    // Each cycle: evalResult(fail) → recovery → workerFinished → eval_deep_required
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS + 1; i++) {
      const stateBefore = await readState(tmpDir, sagaId);
      if (stateBefore.termination) break;

      // Submit eval result only when in eval_deep_pending
      if (stateBefore.transition?.kind === 'eval_deep_pending') {
        const evalR = await advance({
          sagaId,
          evalResult: { passed: false, score: 1.0, issues: [`failure ${i + 1}`] },
        }, deps);

        const afterEval = await readState(tmpDir, sagaId);
        if (afterEval.termination) break;
      }

      // Worker finishes again to re-trigger hard-checks → deep-eval
      const stateAfter = await readState(tmpDir, sagaId);
      if (stateAfter.termination) break;

      // If transition is one of the recovery transitions, worker needs to submit
      const t = stateAfter.transition?.kind;
      if (t === 'eval_needs_fix_attempt' || t === 'microcompact_retry' || t === 'rework_full' || t === 'worker_mode_injected') {
        await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'B'.repeat(500) + String(i));
        const workerR = await advance({ sagaId, workerFinished: true }, deps);
        if (workerR.nextAction === 'terminated') break;
      }
    }

    const finalState = await readState(tmpDir, sagaId);
    expect(finalState.termination).toBeDefined();
    expect(finalState.termination?.reason).toBe('worker_unrecoverable');

    const events = await readEvents(tmpDir, sagaId);
    expect(events.some(e => e.type === 'saga_terminated')).toBe(true);
  });
});
