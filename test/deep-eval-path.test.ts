/**
 * Deep evaluator inline flow test.
 *
 * Tests the eval_deep_required → evalResult submission path,
 * including pass, fail, and cascading recovery integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSaga, advance } from '../src/coordinator/advance.js';
import type { AdvanceDeps, SagaState, Stage, Plan, SagaEvent, EvalVerdict, HardCheckResult } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent, readEvents } from '../src/storage/events.js';
import { writeArtifact } from '../src/storage/artifact-store.js';
import { runDoneChecks } from '../src/stage-spec/done-criteria.js';
import { buildDeepEvalPrompt } from '../src/roles/evaluator-deep.js';
import { getProfile } from '../src/profiles/index.js';
import { EvalChecklist } from '../src/profiles/checklist-schema.js';
import type { EvalChecklistType } from '../src/profiles/checklist-schema.js';

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
    summary: 'Test plan with deep eval stages',
    stages: [
      makeDeepEvalStage('stage-01', 'Research'),
      makeDeepEvalStage('stage-02', 'Analysis'),
    ],
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
      let artifactContent = '';
      for (const c of stage.doneCriteria.filter(c => c.kind === 'file-exists')) {
        const content = await import('../src/storage/artifact-store.js')
          .then(m => m.readArtifact(stateRoot, state.sagaId, String(c.path ?? '')));
        if (content) artifactContent += content;
      }
      const profileDef = getProfile(state.profile);
      const checklist: EvalChecklistType = {
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
      return buildDeepEvalPrompt({
        stageId: stage.id,
        stageTitle: stage.title,
        stageGoal: stage.goal,
        doneCriteriaText: stage.doneCriteria.map(c => c.kind).join(', '),
        artifactContent: artifactContent || '(no artifact)',
        profile: profileDef,
        fewShotExamples: '',
        checklist,
      });
    },
    async queueWorkerModeInjection() {},
    async runClarifier() { return { skip: true as const }; },
  };
}

describe('deep evaluator flow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-deep-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns eval_deep_required when deep stage has hard checks pass', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-deep-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Deep eval test', deps);

    // Planner
    await advance({ sagaId }, deps);

    // Worker finishes — write artifact so hard check passes
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    const r = await advance({ sagaId, workerFinished: true }, deps);

    // Should return eval_deep_required (not auto eval)
    expect(r.nextAction).toBe('eval_deep_required');
    if (r.nextAction === 'eval_deep_required') {
      expect(r.evalPrompt).toContain('evaluator');
      expect(r.evalPrompt).toContain('stage-01');
      expect(r.stageId).toBe('stage-01');
    }

    // State should be eval_deep_pending
    const state = await readState(tmpDir, sagaId);
    expect(state.transition?.kind).toBe('eval_deep_pending');

    // Events should include eval_deep_required
    const events = await readEvents(tmpDir, sagaId);
    expect(events.some(e => e.type === 'eval_deep_required')).toBe(true);
  });

  it('completes full deep eval happy-path: hard check → eval → advance', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-deep-002';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Deep eval full path', deps);

    // Planner
    await advance({ sagaId }, deps);

    // Stage 1: worker + hard check → eval_deep_required
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'Research report content'.repeat(50));
    const r1 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r1.nextAction).toBe('eval_deep_required');

    // Agent submits deep eval verdict (pass)
    const r2 = await advance({
      sagaId,
      evalResult: { passed: true, score: 4.2, issues: [] },
    }, deps);
    expect(r2.nextAction).toBe('worker_mode_queued');
    if (r2.nextAction === 'worker_mode_queued') {
      expect(r2.stageId).toBe('stage-02');
    }

    // Stage 2: worker + hard check → eval_deep_required
    await writeArtifact(tmpDir, sagaId, 'stages/stage-02-report.md', 'Analysis report content'.repeat(50));
    const r3 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r3.nextAction).toBe('eval_deep_required');

    // Agent submits deep eval verdict (pass) → saga completes
    const r4 = await advance({
      sagaId,
      evalResult: { passed: true, score: 3.8, issues: [] },
    }, deps);
    expect(r4.nextAction).toBe('terminated');
    if (r4.nextAction === 'terminated') {
      expect(r4.reason).toBe('completed');
    }

    // Verify events
    const events = await readEvents(tmpDir, sagaId);
    const types = events.map(e => e.type);
    expect(types).toContain('eval_deep_required');
    expect(types).toContain('deep_eval_completed');
    expect(types.filter(t => t === 'deep_eval_completed')).toHaveLength(2);
    expect(types).toContain('saga_terminated');
  });

  it('deep eval failure triggers revision_queued', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-deep-003';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Deep eval fail', deps);
    await advance({ sagaId }, deps);

    // Worker finishes
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'A'.repeat(500));
    const r1 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r1.nextAction).toBe('eval_deep_required');

    // Agent submits eval verdict (fail)
    const r2 = await advance({
      sagaId,
      evalResult: { passed: false, score: 2.1, issues: ['Incomplete research', 'No sources cited'] },
    }, deps);
    expect(r2.nextAction).toBe('revision_queued');
    if (r2.nextAction === 'revision_queued') {
      expect(r2.reason).toContain('Incomplete research');
    }
  });

  it('deep eval escalate=true triggers await_human instead of rework loop', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-deep-escalate';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Escalate test', deps);
    await advance({ sagaId }, deps);

    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'B'.repeat(500));
    const r1 = await advance({ sagaId, workerFinished: true }, deps);
    expect(r1.nextAction).toBe('eval_deep_required');

    // Evaluator determines criteria are structurally unachievable
    const r2 = await advance({
      sagaId,
      evalResult: {
        passed: false,
        score: 2.0,
        issues: ['Tesla training data volumes are proprietary and not publicly disclosed'],
        escalate: true,
      },
    }, deps);

    // Must pause for human decision, NOT trigger rework
    expect(r2.nextAction).toBe('await_human');
    if (r2.nextAction === 'await_human') {
      expect(r2.diagnostic).toContain('验收标准无法达成');
      expect(r2.diagnostic).toContain('saga_cancel');
    }

    // State must be awaiting_human, not recovery
    const state = await readState(tmpDir, sagaId);
    expect(state.transition?.kind).toBe('awaiting_human');
  });

  it('auto mode stages skip deep eval', async () => {
    const deps: AdvanceDeps = {
      ...makeDeps(tmpDir),
      async runPlanner() {
        return {
          plan: {
            summary: 'Auto plan',
            stages: [{
              id: 'stage-01',
              title: 'Auto Stage',
              goal: 'Auto test',
              doneCriteria: [{ kind: 'file-exists', path: 'stages/stage-01-report.md' }],
              evaluatorMode: 'auto',
            }],
          },
        };
      },
    };
    const sagaId = 'test-auto-001';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Auto eval test', deps);
    await advance({ sagaId }, deps);

    // Worker finishes with artifact
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', 'Auto report'.repeat(100));
    const r = await advance({ sagaId, workerFinished: true }, deps);

    // Auto mode should go straight to terminated (1 stage, all passed)
    expect(r.nextAction).toBe('terminated');
    if (r.nextAction === 'terminated') {
      expect(r.reason).toBe('completed');
    }
  });

  it('deep eval prompt contains artifact content', async () => {
    const deps = makeDeps(tmpDir);
    const sagaId = 'test-deep-prompt';

    await ensureSagaDir(tmpDir, sagaId);
    await createSaga(sagaId, 'research', 'Prompt test', deps);
    await advance({ sagaId }, deps);

    // Write specific content
    const content = 'This is the research report about lithium batteries.';
    await writeArtifact(tmpDir, sagaId, 'stages/stage-01-report.md', content);
    const r = await advance({ sagaId, workerFinished: true }, deps);

    expect(r.nextAction).toBe('eval_deep_required');
    if (r.nextAction === 'eval_deep_required') {
      expect(r.evalPrompt).toContain('lithium batteries');
      expect(r.evalPrompt).toContain('stage-01');
      expect(r.evalPrompt).toContain('checklist'); // research profile uses checklist-based eval
    }
  });
});
