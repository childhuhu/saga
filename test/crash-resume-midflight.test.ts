/**
 * Crash-resume mid-flight test.
 *
 * Verifies that reconstructFromEvents can rebuild saga state after
 * state.json is lost at arbitrary points in the lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance, resumeSaga } from '../src/coordinator/advance.js';
import type { AdvanceDeps, SagaState, Stage, Plan, SagaEvent, HardCheckResult } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent, readEvents } from '../src/storage/events.js';
import { writeArtifact } from '../src/storage/artifact-store.js';
import { runDoneChecks } from '../src/stage-spec/done-criteria.js';

function makePlan(): Plan {
  return {
    summary: 'Crash resume test plan',
    stages: [
      {
        id: 'stage-01', title: 'Research', goal: 'Do research',
        doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-01-report.md' }],
        evaluatorMode: 'auto',
      },
      {
        id: 'stage-02', title: 'Analysis', goal: 'Analyze',
        doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-02-report.md' }],
        evaluatorMode: 'auto',
      },
      {
        id: 'stage-03', title: 'Report', goal: 'Write report',
        doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-03-report.md' }],
        evaluatorMode: 'auto',
      },
    ],
  };
}

function makeDeps(stateRoot: string): AdvanceDeps {
  return {
    async readState(sagaId: string) { return readState(stateRoot, sagaId); },
    async writeState(state: SagaState) { await writeState(stateRoot, state); },
    async appendEvent(sagaId: string, event: SagaEvent) { await appendEvent(stateRoot, sagaId, event); },
    async runPlanner() { return { plan: makePlan() }; },
    async runEvaluator() { return { passed: true, issues: [], score: 0.9 }; },
    async runHardChecks(stage: Stage, state: SagaState): Promise<HardCheckResult[]> {
      return runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
    },
    async buildDeepEvalPrompt() { return 'Deep eval'; },
    async queueWorkerModeInjection() {},
    async runClarifier() { return { skip: true as const }; },
  };
}

describe('crash-resume mid-flight', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-crash-mid-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reconstructs after stage-01 completed, mid stage-02', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'crash-mid-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'goal', deps);

    // Plan
    await advance({ sagaId }, deps);

    // Stage 1: worker finishes
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'X'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);

    // Stage 2 is now active (cursor=1, worker_mode_injected)

    // Simulate crash: delete state.json
    await fs.unlink(path.join(tmpDir, 'runs', sagaId, 'state.json'));

    // Resume from events
    const { state, result } = await resumeSaga(sagaId, {
      ...deps,
      readEvents: (id: string) => readEvents(tmpDir, id),
    });

    expect(state.cursor).toBe(1);
    expect(state.stages).toHaveLength(3);
    expect(state.transition?.kind).toBe('worker_mode_injected');
  });

  it('reconstructs after recovery attempt', async () => {
    const deps: AdvanceDeps = {
      ...makeDeps(tmpDir),
      async runEvaluator() {
        return { passed: false, issues: ['quality insufficient'], score: 0.3 };
      },
    };
    const sagaId = 'crash-recovery-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'goal', deps);
    await advance({ sagaId }, deps);

    // Stage 1: worker finishes, eval fails → recovery
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'X'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);

    // Should be in recovery state
    const midState = await readState(tmpDir, sagaId);
    expect(midState.recoveryAttempts['stage-01']).toBeGreaterThanOrEqual(1);

    // Simulate crash
    await fs.unlink(path.join(tmpDir, 'runs', sagaId, 'state.json'));

    // Resume
    const { state } = await resumeSaga(sagaId, {
      ...deps,
      readEvents: (id: string) => readEvents(tmpDir, id),
    });

    expect(state.recoveryAttempts['stage-01']).toBeGreaterThanOrEqual(1);
    expect(state.stages).toHaveLength(3);
  });

  it('reconstructs after terminated saga', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'crash-term-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'goal', deps);
    await advance({ sagaId }, deps);

    // Complete all 3 stages
    for (let i = 1; i <= 3; i++) {
      const stageId = `stage-${String(i).padStart(2, '0')}`;
      await writeArtifact(tmpDir, sagaId, `stages/${stageId}-report.md`, 'C'.repeat(500));
      await advance({ sagaId, workerFinished: true }, deps);
    }

    // Saga should be completed
    const completedState = await readState(tmpDir, sagaId);
    expect(completedState.termination?.reason).toBe('completed');

    // Simulate crash
    await fs.unlink(path.join(tmpDir, 'runs', sagaId, 'state.json'));

    // Resume should detect termination
    const { state } = await resumeSaga(sagaId, {
      ...deps,
      readEvents: (id: string) => readEvents(tmpDir, id),
    });

    expect(state.termination).toBeDefined();
    expect(state.termination?.reason).toBe('completed');
  });
});
