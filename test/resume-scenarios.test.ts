/**
 * R1 resume scenarios: soft-resume and crash-resume.
 *
 * These test the saga_resume path which reconstructs state from
 * events.jsonl when state.json is missing or stale.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance, resumeSaga } from '../src/coordinator/advance.js';
import type { AdvanceDeps, SagaState, Stage, Plan, SagaEvent } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent, readEvents } from '../src/storage/events.js';
import { writeArtifact } from '../src/storage/artifact-store.js';
import { runDoneChecks } from '../src/stage-spec/done-criteria.js';
import type { HardCheckResult, EvalVerdict } from '../src/coordinator/state.js';

function makeDeps(stateRoot: string): AdvanceDeps {
  const stages: Stage[] = [
    { id: 'stage-01', title: 'Stage 1', goal: 'First', doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-01-report.md' }], evaluatorMode: 'auto' },
    { id: 'stage-02', title: 'Stage 2', goal: 'Second', doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-02-report.md' }], evaluatorMode: 'auto' },
    { id: 'stage-03', title: 'Stage 3', goal: 'Third', doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-03-report.md' }], evaluatorMode: 'auto' },
  ];
  const plan: Plan = { summary: 'Test plan', stages };

  return {
    async readState(sagaId: string) { return readState(stateRoot, sagaId); },
    async writeState(state: SagaState) { await writeState(stateRoot, state); },
    async appendEvent(sagaId: string, event: SagaEvent) { await appendEvent(stateRoot, sagaId, event); },
    async runPlanner() { return { plan }; },
    async runEvaluator(state: SagaState, stage: Stage): Promise<EvalVerdict> {
      const results = await runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
      const machine = results.filter((r) => r.criterion.kind !== 'free-form');
      return { passed: machine.every((r) => r.passed), issues: results.filter((r) => !r.passed).map((r) => r.detail), score: null };
    },
    async runHardChecks(stage: Stage, state: SagaState): Promise<HardCheckResult[]> {
      return runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
    },
    async queueWorkerModeInjection() {},
    async runClarifier() { return { skip: true as const }; },
    async buildDeepEvalPrompt() { return 'Deep eval prompt for test'; },
  };
}

describe('resume scenarios', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-resume-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('soft-resume: advance() resumes from worker_mode_injected after gap', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-soft-resume';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Soft resume test', deps);

    // Run planner → worker_mode_queued for stage-01
    await advance({ sagaId }, deps);

    const state = await readState(tmpDir, sagaId);
    expect(state.transition?.kind).toBe('worker_mode_injected');

    // Simulate a gap (no interaction) — just call advance again without workerFinished
    // This should return continue_worker_now
    const result = await advance({ sagaId }, deps);
    expect(result.nextAction).toBe('continue_worker_now');

    // Now write artifact and finish
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'X'.repeat(500));
    const result2 = await advance({ sagaId, workerFinished: true }, deps);
    expect(result2.nextAction).toBe('worker_mode_queued');
  });

  it('crash-resume: resumeSaga reconstructs from events when state.json is deleted', async () => {
    const deps = makeDeps(tmpDir);
    const depsWithEvents = {
      ...deps,
      async readEvents(sagaId: string) { return readEvents(tmpDir, sagaId); },
    };
    const sagaId = 'test-crash-resume';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Crash resume test', deps);

    // Run to completion
    await advance({ sagaId }, deps);
    for (let i = 1; i <= 3; i++) {
      await writeArtifact(tmpDir, sagaId, `stages/stage-${String(i).padStart(2, '0')}-report.md`, 'X'.repeat(500));
      await advance({ sagaId, workerFinished: true }, deps);
    }

    // Verify terminated
    const state = await readState(tmpDir, sagaId);
    expect(state.termination?.reason).toBe('completed');

    // Delete state.json — simulate crash
    const statePath = path.join(tmpDir, 'runs', sagaId, 'state.json');
    await fs.unlink(statePath);

    // Resume should reconstruct from events
    const { result } = await resumeSaga(sagaId, depsWithEvents);
    expect(result.nextAction).toBe('terminated');
  });

  it('crash-resume: reconstructs saga_created goal and profile from events', async () => {
    const deps = makeDeps(tmpDir);
    const depsWithEvents = {
      ...deps,
      async readEvents(sagaId: string) { return readEvents(tmpDir, sagaId); },
    };
    const sagaId = 'test-crash-meta';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Original goal here', deps);
    await advance({ sagaId }, deps);

    // Delete state.json
    await fs.unlink(path.join(tmpDir, 'runs', sagaId, 'state.json'));

    const { state } = await resumeSaga(sagaId, depsWithEvents);
    expect(state.profile).toBe('research');
    expect(state.goal).toBe('Original goal here');
  });

  it('soft-resume: awaiting_human state persists across advance calls', async () => {
    // This tests the awaiting_human continue-site
    // We need to manually set the state to awaiting_human
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-await-resume';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Await resume test', deps);
    await advance({ sagaId }, deps);

    // Manually set state to awaiting_human
    const state = await readState(tmpDir, sagaId);
    state.transition = { kind: 'awaiting_human', reason: 'Need user input' };
    await writeState(tmpDir, state);

    // Advance without human input → should return await_human
    const r1 = await advance({ sagaId }, deps);
    expect(r1.nextAction).toBe('await_human');

    // Advance with human input → should re-enter worker mode
    const r2 = await advance({ sagaId, humanInput: 'User says go ahead' }, deps);
    expect(r2.nextAction).toBe('worker_mode_queued');
  });
});
