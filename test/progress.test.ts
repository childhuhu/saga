import { describe, it, expect } from 'vitest';
import { buildProgressSummary } from '../src/coordinator/progress.js';
import { initialSagaState } from '../src/coordinator/state.js';

describe('buildProgressSummary', () => {
  it('renders 0/3 at start', () => {
    const state = {
      ...initialSagaState('s', 'research', 'g'),
      stages: [
        { id: 's1', title: 'Alpha', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
        { id: 's2', title: 'Beta', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
        { id: 's3', title: 'Gamma', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
      ],
      cursor: 0,
    };
    const p = buildProgressSummary(state);
    expect(p.totalStages).toBe(3);
    expect(p.completedStages).toBe(0);
    expect(p.display).toContain('0/3');
    expect(p.display).toContain('🔄 Stage 1: Alpha');
    expect(p.display).toContain('⬜ Stage 2: Beta');
  });

  it('renders 2/3 mid-saga', () => {
    const state = {
      ...initialSagaState('s', 'research', 'g'),
      stages: [
        { id: 's1', title: 'Alpha', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
        { id: 's2', title: 'Beta', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
        { id: 's3', title: 'Gamma', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
      ],
      cursor: 2,
    };
    const p = buildProgressSummary(state);
    expect(p.completedStages).toBe(2);
    expect(p.currentStage).toEqual({ id: 's3', title: 'Gamma' });
    expect(p.display).toContain('2/3');
    expect(p.display).toContain('✅ Stage 1: Alpha');
    expect(p.display).toContain('✅ Stage 2: Beta');
    expect(p.display).toContain('🔄 Stage 3: Gamma');
  });

  it('renders 3/3 completed', () => {
    const state = {
      ...initialSagaState('s', 'research', 'g'),
      stages: [
        { id: 's1', title: 'Alpha', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
        { id: 's2', title: 'Beta', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
        { id: 's3', title: 'Gamma', goal: 'g', doneCriteria: [], evaluatorMode: 'auto' as const },
      ],
      cursor: 3,
    };
    const p = buildProgressSummary(state);
    expect(p.completedStages).toBe(3);
    expect(p.currentStage).toBeNull();
    expect(p.remainingStages).toHaveLength(0);
    expect(p.display).toContain('3/3');
    expect(p.display).toContain('✅ Stage 3: Gamma');
    expect(p.display).not.toContain('🔄');
  });
});
