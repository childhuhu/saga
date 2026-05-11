import type { SagaState } from './state.js';

export interface ProgressSummary {
  totalStages: number;
  completedStages: number;
  currentStage: { id: string; title: string } | null;
  remainingStages: Array<{ id: string; title: string }>;
  display: string;
}

export function buildProgressSummary(state: SagaState): ProgressSummary {
  const total = state.stages.length;
  const cursor = state.cursor;
  const current = state.stages[cursor] ?? null;

  const lines: string[] = [`\u{1F4CB} Saga 进度: ${Math.min(cursor, total)}/${total} 阶段完成`];
  state.stages.forEach((s, i) => {
    if (i < cursor) lines.push(`✅ Stage ${i + 1}: ${s.title} — 已完成`);
    else if (i === cursor) lines.push(`🔄 Stage ${i + 1}: ${s.title} — 进行中`);
    else lines.push(`⬜ Stage ${i + 1}: ${s.title} — 待开始`);
  });

  return {
    totalStages: total,
    completedStages: Math.min(cursor, total),
    currentStage: current ? { id: current.id, title: current.title } : null,
    remainingStages: state.stages.slice(cursor + 1).map((s) => ({ id: s.id, title: s.title })),
    display: lines.join('\n'),
  };
}
