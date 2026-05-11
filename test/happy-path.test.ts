/**
 * Integration test: fake-LLM happy-path through the coordinator.
 *
 * Exercises the minimal continue-site chain:
 *   create → advance(plan) → advance(worker finish × N) → completed
 *
 * All deps are faked — no real LLM, no OpenClaw. Real filesystem via tmp dir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance, resumeSaga } from '../src/coordinator/advance.js';
import type { AdvanceDeps, AdvanceInput, SagaState, Stage, Plan, SagaEvent } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent, readEvents } from '../src/storage/events.js';
import { writeArtifact } from '../src/storage/artifact-store.js';

// ── Test fixtures ────────────────────────────────────────────────────

function makeFakePlan(stageCount: number): Plan {
  const stages: Stage[] = [];
  for (let i = 1; i <= stageCount; i++) {
    const id = `stage-${String(i).padStart(2, '0')}`;
    stages.push({
      id,
      title: `Stage ${i}`,
      goal: `Complete stage ${i}`,
      doneCriteria: [
        { kind: 'file-exists', path: `stages/${id}-report.md` },
      ],
      evaluatorMode: 'auto',
    });
  }
  return { summary: `Test plan with ${stageCount} stages`, stages };
}

function makeFakeDeps(stateRoot: string): AdvanceDeps {
  const fakePlan = makeFakePlan(3);

  return {
    async readState(sagaId: string) {
      return readState(stateRoot, sagaId);
    },

    async writeState(state: SagaState) {
      await writeState(stateRoot, state);
    },

    async appendEvent(sagaId: string, event: SagaEvent) {
      await appendEvent(stateRoot, sagaId, event);
    },

    async runPlanner() {
      return { plan: fakePlan };
    },

    async runEvaluator() {
      return { passed: true, issues: [], score: 0.9 };
    },

    async runHardChecks(stage: Stage, state: SagaState) {
      const results = [];
      for (const c of stage.doneCriteria) {
        if (c.kind === 'file-exists') {
          // c.path is relative to artifacts dir
          const fullPath = path.join(stateRoot, 'runs', state.sagaId, 'artifacts', String(c.path));
          const exists = await fs.access(fullPath).then(() => true).catch(() => false);
          results.push({
            criterion: c,
            passed: exists,
            detail: exists ? 'file exists' : `file not found: ${c.path}`,
          });
        } else {
          results.push({ criterion: c, passed: true, detail: `kind=${c.kind}: auto-pass` });
        }
      }
      return results;
    },

    async queueWorkerModeInjection() {
      // no-op in test
    },
    async runClarifier() { return { skip: true as const }; },

    async buildDeepEvalPrompt() {
      return 'Deep eval prompt for test';
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('coordinator happy-path', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a saga and runs planner on first advance', async () => {
    const deps = makeFakeDeps(tmpDir);
    const sagaId = 'test-saga-001';

    await ensureSagaDir(tmpDir, sagaId);
    const state = await createSaga(sagaId, 'research', 'Research Tesla labeling tools', deps);

    expect(state.sagaId).toBe(sagaId);
    expect(state.profile).toBe('research');
    expect(state.plan).toBeUndefined();

    // First advance triggers planner
    const result = await advance({ sagaId }, deps);
    expect(result.nextAction).toBe('worker_mode_queued');
    if (result.nextAction === 'worker_mode_queued') {
      expect(result.stageId).toBe('stage-01');
    }

    // State should now have a plan
    const updated = await readState(tmpDir, sagaId);
    expect(updated.plan).toBeDefined();
    expect(updated.stages).toHaveLength(3);
    expect(updated.cursor).toBe(0);
  });

  it('completes full happy-path: 3 stages → completed', async () => {
    const deps = makeFakeDeps(tmpDir);
    const sagaId = 'test-saga-002';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research Tesla labeling tools', deps);

    // Advance 1: run planner
    const r1 = await advance({ sagaId }, deps);
    expect(r1.nextAction).toBe('worker_mode_queued');

    // Advance 2: worker finishes stage 1
    // Write the artifact first so hard-check passes
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    const r2 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r2.nextAction).toBe('worker_mode_queued');
    if (r2.nextAction === 'worker_mode_queued') {
      expect(r2.stageId).toBe('stage-02');
    }

    // Advance 3: worker finishes stage 2
    await writeArtifact(tmpDir, sagaId, 'stages/stage-02-report.md', 'B'.repeat(500));
    const r3 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r3.nextAction).toBe('worker_mode_queued');
    if (r3.nextAction === 'worker_mode_queued') {
      expect(r3.stageId).toBe('stage-03');
    }

    // Advance 4: worker finishes stage 3 — saga should complete
    await writeArtifact(tmpDir, sagaId, 'stages/stage-03-report.md', 'C'.repeat(500));
    const r4 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r4.nextAction).toBe('terminated');
    if (r4.nextAction === 'terminated') {
      expect(r4.reason).toBe('completed');
    }

    // Verify final state
    const final = await readState(tmpDir, sagaId);
    expect(final.termination).toBeDefined();
    expect(final.termination!.reason).toBe('completed');
    expect(final.cursor).toBe(3); // past the last stage

    // Verify events log
    const events = await readEvents(tmpDir, sagaId);
    const types = events.map((e) => e.type);
    expect(types).toContain('saga_created');
    expect(types).toContain('plan_produced');
    expect(types).toContain('saga_terminated');
    expect(types.filter((t) => t === 'eval_completed')).toHaveLength(3);
    expect(types.filter((t) => t === 'stage_advanced')).toHaveLength(2);
  });

  it('returns revision_queued when hard-check fails', async () => {
    const deps = makeFakeDeps(tmpDir);
    const sagaId = 'test-saga-003';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research Tesla', deps);

    // Advance: planner
    await advance({ sagaId }, deps);

    // Advance: worker says finished but artifact doesn't exist
    const r2 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r2.nextAction).toBe('revision_queued');
    if (r2.nextAction === 'revision_queued') {
      expect(r2.stageId).toBe('stage-01');
      expect(r2.reason).toContain('file not found');
    }
  });

  it('terminates with worker_unrecoverable after max recovery attempts', async () => {
    const deps = makeFakeDeps(tmpDir);
    const sagaId = 'test-saga-004';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research Tesla', deps);

    // Advance: planner
    await advance({ sagaId }, deps);

    // Attempt 0: fix-attempt → revision_queued
    const r0 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r0.nextAction).toBe('revision_queued');

    // Attempt 1: fix-attempt → revision_queued
    const r1 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r1.nextAction).toBe('revision_queued');

    // Attempt 2: microcompact → revision_queued
    const r2 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r2.nextAction).toBe('revision_queued');

    // Attempt 3: full-rework → worker_mode_queued (fresh start)
    const r3 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r3.nextAction).toBe('worker_mode_queued');

    // Attempt 4: hits terminal (all recovery layers exhausted)
    const r4 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r4.nextAction).toBe('terminated');
    if (r4.nextAction === 'terminated') {
      expect(r4.reason).toBe('worker_unrecoverable');
    }
  });

  it('does not advance a terminated saga', async () => {
    const deps = makeFakeDeps(tmpDir);
    const sagaId = 'test-saga-005';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Research Tesla', deps);

    // Run to completion
    await advance({ sagaId }, deps);
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);
    await writeArtifact(tmpDir, sagaId, 'stages/stage-02-report.md', 'B'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);
    await writeArtifact(tmpDir, sagaId, 'stages/stage-03-report.md', 'C'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);

    // Try to advance again
    const r = await advance({ sagaId, workerFinished: true }, deps);
    expect(r.nextAction).toBe('terminated');
  });
});

describe('coordinator resume', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-resume-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resumes a saga and determines next action', async () => {
    const fakePlan = makeFakePlan(2);
    const deps = makeFakeDeps(tmpDir);
    const depsWithEvents = {
      ...deps,
      async readEvents(sagaId: string) {
        return readEvents(tmpDir, sagaId);
      },
    };
    const sagaId = 'test-resume-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Resume test', deps);

    // Run planner
    await advance({ sagaId }, deps);

    // Write artifact and finish stage 1
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    await advance({ sagaId, workerFinished: true }, deps);

    // Now resume — should find we're in worker_mode for stage 2
    const { result } = await resumeSaga(sagaId, depsWithEvents);
    expect(result.nextAction).toBe('continue_worker_now');
  });

  it('resumes a terminated saga with terminated result', async () => {
    const deps = makeFakeDeps(tmpDir);
    const depsWithEvents = { ...deps, async readEvents(sagaId: string) { return readEvents(tmpDir, sagaId); } };
    const sagaId = 'test-resume-002';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Resume test', deps);

    // Run to completion
    await advance({ sagaId }, deps);
    for (let i = 1; i <= 3; i++) {
      await writeArtifact(tmpDir, sagaId, `stages/stage-${String(i).padStart(2, '0')}-report.md`, 'X'.repeat(500));
      await advance({ sagaId, workerFinished: true }, deps);
    }

    const { result } = await resumeSaga(sagaId, depsWithEvents);
    expect(result.nextAction).toBe('terminated');
  });
});
