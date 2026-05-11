/**
 * Saga-microcompact: downgrade old evaluator output to compact form (§4.3 L1).
 *
 * Takes a full eval JSON and produces a compact version with:
 * - verdict, score, summary (≤200 chars), pointer to original
 */

export interface CompactEval {
  verdict: 'passed' | 'rework' | 'needs-human';
  score: number | null;
  summary: string;
  pointer: string;
}

export interface FullEval {
  passed: boolean;
  issues?: string[];
  score?: number | null;
  summary?: string;
  details?: string;
}

/**
 * Compact a full eval result into a minimal summary.
 */
export function microcompactEval(full: FullEval, stageId: string): CompactEval {
  const verdict = full.passed ? 'passed' : 'rework';
  const rawSummary = full.summary ?? full.details ?? (full.issues ?? []).join('; ');

  return {
    verdict,
    score: full.score ?? null,
    summary: rawSummary.length > 200 ? rawSummary.slice(0, 197) + '...' : rawSummary,
    pointer: `see-original-at-${stageId}-eval.json`,
  };
}

/**
 * Check if an eval has already been compacted.
 */
export function isAlreadyCompacted(evalData: unknown): evalData is CompactEval {
  return (
    typeof evalData === 'object' &&
    evalData !== null &&
    'verdict' in evalData &&
    'summary' in evalData &&
    'pointer' in evalData
  );
}
