/**
 * Clarification phase tests.
 *
 * Verifies the clarification continue-site (site 0):
 * - coding profile (limit=0) skips, goes straight to planner
 * - research profile (limit=3) asks rounds
 * - user says "够了" to end early
 * - humanInput accumulates into clarificationHistory
 * - enrichedGoal is passed to planner
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance } from '../src/coordinator/advance.js';
import type { AdvanceDeps, SagaState, Stage, Plan, SagaEvent, HardCheckResult, EvalVerdict } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent } from '../src/storage/events.js';

function makePlan(): Plan {
  return {
    summary: 'Test plan',
    stages: [{
      id: 'stage-01', title: 'Stage 1', goal: 'Do the thing',
      doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-01-report.md' }],
      evaluatorMode: 'auto',
    }],
  };
}

function makeDeps(stateRoot: string, opts?: { runClarifier?: AdvanceDeps['runClarifier']; plan?: Plan }): AdvanceDeps {
  return {
    async readState(sagaId: string) { return readState(stateRoot, sagaId); },
    async writeState(state: SagaState) { await writeState(stateRoot, state); },
    async appendEvent(sagaId: string, event: SagaEvent) { await appendEvent(stateRoot, sagaId, event); },
    async runPlanner() { return { plan: opts?.plan ?? makePlan() }; },
    async runEvaluator() { return { passed: true, issues: [], score: 0.9 }; },
    async runHardChecks(): Promise<HardCheckResult[]> { return []; },
    async buildDeepEvalPrompt() { return 'eval'; },
    async queueWorkerModeInjection() {},
    runClarifier: opts?.runClarifier ?? (async () => ({ questions: ['What is the scope?', 'Any specific requirements?'] })),
  };
}

describe('clarification phase', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-clarify-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ops profile (limit=2) starts clarification', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'clarify-ops-001';
    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'ops', 'Diagnose WiFi drops', deps);

    const result = await advance({ sagaId }, deps);
    expect(result.nextAction).toBe('clarification_needed');

    const state = await readState(tmpDir, sagaId);
    expect(state.clarificationLimit).toBe(2);
    expect(state.clarificationRound).toBe(0);
  });

  it('research profile asks clarification questions', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'clarify-research-001';
    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research lithium batteries', deps);

    const result = await advance({ sagaId }, deps);
    expect(result.nextAction).toBe('clarification_needed');
    if (result.nextAction === 'clarification_needed') {
      expect(result.questions).toHaveLength(2);
      expect(result.round).toBe(0);
      expect(result.limit).toBe(2);
    }

    const state = await readState(tmpDir, sagaId);
    expect(state.transition?.kind).toBe('clarifying_requirements');
  });

  it('user saying "够了" ends clarification early', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'clarify-early-001';
    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research topic', deps);

    // First advance triggers clarification
    await advance({ sagaId }, deps);

    // User says "够了" — should end clarification and go to planner
    const result = await advance({ sagaId, humanInput: '够了, proceed with general research' }, deps);
    expect(result.nextAction).toBe('worker_mode_queued');

    const state = await readState(tmpDir, sagaId);
    expect(state.clarificationHistory).toHaveLength(1);
  });

  it('humanInput accumulates into clarificationHistory', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'clarify-hist-001';
    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research topic', deps);

    // Round 0: trigger clarification
    await advance({ sagaId }, deps);

    // Round 1: user answers
    await advance({ sagaId, humanInput: 'Focus on safety aspects' }, deps);

    // Round 2: user answers again
    await advance({ sagaId, humanInput: 'Include recent papers only' }, deps);

    const state = await readState(tmpDir, sagaId);
    expect(state.clarificationHistory).toHaveLength(2);
    expect(state.clarificationHistory[0]!.answer).toBe('Focus on safety aspects');
    expect(state.clarificationHistory[1]!.answer).toBe('Include recent papers only');
  });

  it('enrichedGoal is passed to planner with clarification context', async () => {
    let capturedGoal = '';
    const deps: AdvanceDeps = {
      ...makeDeps(tmpDir),
      async runPlanner(goal: string) {
        capturedGoal = goal;
        return { plan: makePlan() };
      },
    };

    const sagaId = 'clarify-enrich-001';
    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research topic', deps);

    // Round 0: trigger clarification
    await advance({ sagaId }, deps);

    // Round 1: user answers
    await advance({ sagaId, humanInput: 'Focus on safety' }, deps);

    // Round 2: user says enough — triggers planner with enriched goal
    await advance({ sagaId, humanInput: '够了' }, deps);

    expect(capturedGoal).toContain('Research topic');
    expect(capturedGoal).toContain('Clarifications:');
    expect(capturedGoal).toContain('Focus on safety');
  });

  it('runClarifier returning skip goes straight to planner', async () => {
    const deps = makeDeps(tmpDir, {
      runClarifier: async () => ({ skip: true as const }),
    });
    const sagaId = 'clarify-skipfn-001';
    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research topic', deps);

    const result = await advance({ sagaId }, deps);
    // Should skip clarification and go straight to planner
    expect(result.nextAction).toBe('worker_mode_queued');
  });
});
