/**
 * Context-collapse: read-time projection for worker injection (§4.3 L2).
 *
 * Does NOT modify disk files. Only changes how history is assembled:
 * - distance ≤ 1: full eval JSON
 * - distance 2–3: compact eval JSON
 * - distance ≥ 4: one-line summary
 */

import type { CompactEval } from './microcompact.js';

export type CollapsedEntry =
  | { level: 'full'; stageId: string; data: unknown }
  | { level: 'compact'; stageId: string; data: CompactEval }
  | { level: 'summary'; stageId: string; line: string };

/**
 * Collapse eval history based on distance from current cursor.
 */
export function collapseHistory(
  entries: Array<{ stageId: string; index: number; evalData: unknown }>,
  currentCursor: number,
): CollapsedEntry[] {
  return entries.map((entry) => {
    const distance = currentCursor - entry.index;

    if (distance <= 1) {
      return { level: 'full' as const, stageId: entry.stageId, data: entry.evalData };
    }

    if (distance <= 3) {
      const compact = isCompactEval(entry.evalData)
        ? entry.evalData
        : { verdict: 'passed' as const, score: null, summary: String(entry.evalData), pointer: `see-original` };
      return { level: 'compact' as const, stageId: entry.stageId, data: compact };
    }

    const summary = oneLineSummary(entry.stageId, entry.evalData);
    return { level: 'summary' as const, stageId: entry.stageId, line: summary };
  });
}

function isCompactEval(data: unknown): data is CompactEval {
  return (
    typeof data === 'object' &&
    data !== null &&
    'verdict' in data &&
    'summary' in data
  );
}

function oneLineSummary(stageId: string, evalData: unknown): string {
  if (isCompactEval(evalData)) {
    return `Stage ${stageId}: ${evalData.verdict} (score ${evalData.score ?? 'n/a'})`;
  }

  if (typeof evalData === 'object' && evalData !== null && 'passed' in evalData) {
    const passed = (evalData as { passed: boolean }).passed;
    return `Stage ${stageId}: ${passed ? 'passed' : 'failed'}`;
  }

  return `Stage ${stageId}: evaluated`;
}
