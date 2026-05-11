/**
 * Integration tests for tool-registrar — saga_start + saga_advance with artifact handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createStartTool, createAdvanceTool, createStatusTool, createCancelTool } from '../src/adapters/tool-registrar.js';
import type { SagaStartDeps } from '../src/adapters/tool-registrar.js';
import type { SagaState, SagaEvent, Stage, Plan, HardCheckResult, EvalVerdict } from '../src/coordinator/state.js';
import { ensureSagaDir, writeState, readState } from '../src/storage/state-store.js';
import { appendEvent } from '../src/storage/events.js';
import { runDoneChecks } from '../src/stage-spec/done-criteria.js';

function makeDeps(stateRoot: string): SagaStartDeps {
  return {
    stateRoot,
    async readState(sagaId: string) { return readState(stateRoot, sagaId); },
    async writeState(state: SagaState) { await writeState(stateRoot, state); },
    async appendEvent(sagaId: string, event: SagaEvent) { await appendEvent(stateRoot, sagaId, event); },

    async runPlanner() {
      return { plan: { summary: '', stages: [] } }; // force plan_required
    },

    async runEvaluator(state: SagaState, stage: Stage): Promise<EvalVerdict> {
      const results = await runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
      const machineResults = results.filter((r) => r.criterion.kind !== 'free-form');
      const allPassed = machineResults.length === 0 || machineResults.every((r) => r.passed);
      const failedDetails = results.filter((r) => !r.passed).map((r) => r.detail);
      return { passed: allPassed, issues: failedDetails, score: null };
    },

    async runHardChecks(stage: Stage, state: SagaState): Promise<HardCheckResult[]> {
      return runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
    },

    async queueWorkerModeInjection() {},
    async runClarifier() { return { skip: true as const }; },
    async buildDeepEvalPrompt() { return 'Deep eval prompt for test'; },
  };
}

const FAKE_CTX = { sessionKey: 'test', agentId: 'test-agent', sessionId: 'test-session' };

describe('tool-registrar', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saga-tools-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saga_start returns plan_required when planner returns empty', async () => {
    const deps = makeDeps(tmpDir);
    const startTool = createStartTool(deps);

    const result = await startTool.handler(
      { goal: 'Test goal', profile: 'research' },
      FAKE_CTX,
    );

    expect(result).toHaveProperty('status', 'plan_required');
    expect(result).toHaveProperty('sagaId');
    expect(result).toHaveProperty('planPrompt');
  });

  it('saga_advance accepts planYaml and parses stages', async () => {
    const deps = makeDeps(tmpDir);
    const startTool = createStartTool(deps);
    const advanceTool = createAdvanceTool(deps);

    // Start saga
    const startResult = await startTool.handler(
      { goal: 'Test goal', profile: 'research' },
      FAKE_CTX,
    ) as { sagaId: string };

    // Submit plan via planYaml
    const planYaml = [
      '## Summary',
      'Test plan',
      '',
      '## Stage 1: Gather info',
      'Goal: Research the topic',
      '```yaml',
      'done:',
      '  - kind: file-exists',
      '    path: stages/stage-01-report.md',
      'evaluator: auto',
      '```',
    ].join('\n');

    const advResult = await advanceTool.handler(
      { sagaId: startResult.sagaId, planYaml },
      FAKE_CTX,
    );

    expect(advResult).toHaveProperty('nextAction', 'worker_mode_queued');
    if ((advResult as any).nextAction === 'worker_mode_queued') {
      expect((advResult as any).stageId).toBe('stage-01');
    }
  });

  it('saga_advance accepts artifacts and passes hard checks', async () => {
    const deps = makeDeps(tmpDir);
    const startTool = createStartTool(deps);
    const advanceTool = createAdvanceTool(deps);

    // Start + plan
    const startResult = await startTool.handler(
      { goal: 'Test goal', profile: 'research' },
      FAKE_CTX,
    ) as { sagaId: string };

    const planYaml = [
      '## Summary', 'Test',
      '',
      '## Stage 1: Test',
      'Goal: Write report',
      '```yaml',
      'done:',
      '  - kind: file-exists',
      '    path: stages/stage-01-report.md',
      '  - kind: free-form',
      '    desc: report is good',
      'evaluator: auto',
      '```',
    ].join('\n');

    await advanceTool.handler(
      { sagaId: startResult.sagaId, planYaml },
      FAKE_CTX,
    );

    // Worker finishes with artifact
    const result = await advanceTool.handler(
      {
        sagaId: startResult.sagaId,
        workerFinished: true,
        artifacts: [
          { path: 'stages/stage-01-report.md', content: 'This is the research report with enough content.' },
        ],
      },
      FAKE_CTX,
    );

    // With only 1 stage, saga should complete
    expect(result).toHaveProperty('nextAction', 'terminated');
    if ((result as any).nextAction === 'terminated') {
      expect((result as any).reason).toBe('completed');
    }

    // Verify artifact was written
    const state = await readState(tmpDir, startResult.sagaId);
    expect(state.termination?.reason).toBe('completed');
  });

  it('saga_advance fails hard checks when artifact is missing', async () => {
    const deps = makeDeps(tmpDir);
    const startTool = createStartTool(deps);
    const advanceTool = createAdvanceTool(deps);

    const startResult = await startTool.handler(
      { goal: 'Test goal', profile: 'research' },
      FAKE_CTX,
    ) as { sagaId: string };

    const planYaml = [
      '## Summary', 'Test',
      '',
      '## Stage 1: Test',
      'Goal: Write report',
      '```yaml',
      'done:',
      '  - kind: file-exists',
      '    path: stages/stage-01-report.md',
      '    minBytes: 100',
      'evaluator: auto',
      '```',
    ].join('\n');

    await advanceTool.handler({ sagaId: startResult.sagaId, planYaml }, FAKE_CTX);

    // Worker finishes WITHOUT artifacts
    const result = await advanceTool.handler(
      { sagaId: startResult.sagaId, workerFinished: true },
      FAKE_CTX,
    );

    expect(result).toHaveProperty('nextAction', 'revision_queued');
  });

  it('saga_status reads current state', async () => {
    const deps = makeDeps(tmpDir);
    const statusTool = createStatusTool(deps.readState);

    // Create saga manually
    const sagaId = 'test-status-001';
    await ensureSagaDir(tmpDir, sagaId);
    const { initialSagaState } = await import('../src/coordinator/state.js');
    await writeState(tmpDir, initialSagaState(sagaId, 'research', 'Status test'));

    const result = await statusTool.handler({ sagaId }, FAKE_CTX);
    expect(result).toHaveProperty('sagaId', sagaId);
    expect(result).toHaveProperty('profile', 'research');
    expect(result).toHaveProperty('progress');
    expect((result as any).progress.totalStages).toBe(0);
  });

  it('saga_cancel terminates a running saga', async () => {
    const deps = makeDeps(tmpDir);
    const cancelTool = createCancelTool(deps.readState, deps.writeState);

    const sagaId = 'test-cancel-001';
    await ensureSagaDir(tmpDir, sagaId);
    const { initialSagaState } = await import('../src/coordinator/state.js');
    await writeState(tmpDir, initialSagaState(sagaId, 'research', 'Cancel test'));

    const result = await cancelTool.handler({ sagaId, reason: 'test cancel' }, FAKE_CTX);
    expect(result).toHaveProperty('status', 'cancelled');

    const state = await readState(tmpDir, sagaId);
    expect(state.termination?.reason).toBe('aborted_by_user');
  });
});
