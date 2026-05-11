import { describe, it, expect } from 'vitest';
import { handleBeforePromptBuild } from '../src/adapters/hook-registrar.js';
import { initialSagaState } from '../src/coordinator/state.js';

const ctx = { sessionId: 's1', agentId: 'a1', sessionKey: 'k1' };

function deps(state: any) {
  return {
    readState: async () => state,
    activeSagaId: async () => 'saga-1',
  };
}

describe('hook-registrar issues injection', () => {
  it('injects issues list on eval_needs_fix_attempt', async () => {
    const state = {
      ...initialSagaState('saga-1', 'research', 'g'),
      stages: [{ id: 'stage-01', title: 'S1', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' }],
      transition: { kind: 'eval_needs_fix_attempt', stageId: 'stage-01', attempt: 1, issues: ['file too short', 'no sources cited'] },
    };
    const r = await handleBeforePromptBuild(ctx, deps(state));
    expect(r.injectSystemMessage).toContain('file too short');
    expect(r.injectSystemMessage).toContain('no sources cited');
    expect(r.injectSystemMessage).toContain('revision needed');
  });

  it('omits issues block when worker_mode_injected', async () => {
    const state = {
      ...initialSagaState('saga-1', 'research', 'g'),
      stages: [{ id: 'stage-01', title: 'S1', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' }],
      transition: { kind: 'worker_mode_injected', stageId: 'stage-01' },
    };
    const r = await handleBeforePromptBuild(ctx, deps(state));
    expect(r.injectSystemMessage).not.toContain('Previous attempt issues');
  });
});
