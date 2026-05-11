/**
 * Multi-profile verification test.
 *
 * Confirms all 4 profiles (coding, research, curation, review)
 * work through the coordinator end-to-end with profile-appropriate stages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance } from '../src/coordinator/advance.js';
import type { AdvanceDeps, SagaState, Stage, Plan, SagaEvent, HardCheckResult, EvalVerdict } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent, readEvents } from '../src/storage/events.js';
import { writeArtifact } from '../src/storage/artifact-store.js';
import { getProfile, allProfiles } from '../src/profiles/index.js';
import type { ProfileId } from '../src/coordinator/state.js';

function makePlanForProfile(profile: ProfileId): Plan {
  const def = getProfile(profile);
  const stageCount = def.recommendedStageCount.min;
  const stages: Stage[] = [];

  for (let i = 1; i <= stageCount; i++) {
    const id = `stage-${String(i).padStart(2, '0')}`;
    stages.push({
      id,
      title: `${def.label} Stage ${i}`,
      goal: `Complete ${def.label.toLowerCase()} stage ${i}`,
      doneCriteria: [
        { kind: 'file-exists', path: `stages/${id}-report.md` },
      ],
      evaluatorMode: def.defaultEvaluatorMode,
    });
  }

  return { summary: `${def.label} plan`, stages };
}

function makeDeps(stateRoot: string, profile: ProfileId): AdvanceDeps {
  const plan = makePlanForProfile(profile);

  return {
    async readState(sagaId: string) { return readState(stateRoot, sagaId); },
    async writeState(state: SagaState) { await writeState(stateRoot, state); },
    async appendEvent(sagaId: string, event: SagaEvent) { await appendEvent(stateRoot, sagaId, event); },
    async runPlanner() { return { plan }; },
    async runEvaluator() { return { passed: true, issues: [], score: null }; },
    async runHardChecks(stage: Stage, state: SagaState): Promise<HardCheckResult[]> {
      const fullPath = path.join(stateRoot, 'runs', state.sagaId, 'artifacts', String(stage.doneCriteria[0]?.path ?? ''));
      const exists = await fs.access(fullPath).then(() => true).catch(() => false);
      return [{
        criterion: stage.doneCriteria[0],
        passed: exists,
        detail: exists ? 'file exists' : 'file not found',
      }];
    },
    async buildDeepEvalPrompt() { return 'Deep eval prompt'; },
    async queueWorkerModeInjection() {},
    async runClarifier() { return { skip: true as const }; },
  };
}

describe('multi-profile verification', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-profile-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const profiles: ProfileId[] = ['ops', 'research', 'curation', 'review', 'generic'];

  for (const profile of profiles) {
    it(`${profile} profile completes through coordinator`, async () => {
      const def = getProfile(profile);
      const deps = makeDeps(tmpDir, profile);
      const sagaId = `test-${profile}-${Date.now()}`;

      await ensureSagaDir(tmpDir, sagaId);
      await createSaga(sagaId, profile, `Test ${profile} task`, deps);

      // Run planner
      const r1 = await advance({ sagaId }, deps);
      expect(r1.nextAction).toBe('worker_mode_queued');

      // Complete each stage
      const plan = makePlanForProfile(profile);
      for (let i = 0; i < plan.stages.length; i++) {
        const stage = plan.stages[i];
        await writeArtifact(tmpDir, sagaId, String(stage.doneCriteria[0].path), 'X'.repeat(500));

        const r = await advance({ sagaId, workerFinished: true }, deps);

        if (stage.evaluatorMode === 'deep') {
          expect(r.nextAction).toBe('eval_deep_required');
          const evalR = await advance({ sagaId, evalResult: { passed: true, score: 4.0, issues: [] } }, deps);
          if (i < plan.stages.length - 1) {
            expect(evalR.nextAction).toBe('worker_mode_queued');
          } else {
            expect(evalR.nextAction).toBe('terminated');
          }
        } else {
          if (i < plan.stages.length - 1) {
            expect(r.nextAction).toBe('worker_mode_queued');
          } else {
            expect(r.nextAction).toBe('terminated');
          }
        }
      }

      // Verify final state
      const final = await readState(tmpDir, sagaId);
      expect(final.termination?.reason).toBe('completed');
      expect(final.profile).toBe(profile);

      // Verify events
      const events = await readEvents(tmpDir, sagaId);
      expect(events.map(e => e.type)).toContain('saga_created');
      expect(events.map(e => e.type)).toContain('saga_terminated');
    });
  }

  it('profile registry has all 5 profiles', () => {
    const all = allProfiles();
    expect(all).toHaveLength(5);
    expect(all.map(p => p.id).sort()).toEqual(['curation', 'generic', 'ops', 'research', 'review']);
  });
});
