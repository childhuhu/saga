/**
 * Error classifiers for cascading recovery (§4.4, §3.3).
 *
 * Maps error signals to termination reasons or recovery strategies.
 * Classifiers are pure functions — no I/O.
 */

import type { HardCheckResult, EvalVerdict, WorkerDiagnostics } from '../coordinator/state.js';
import type { TerminationReason } from '../coordinator/transitions.js';

export interface ClassifiedError {
  category: 'recoverable' | 'terminal';
  terminalReason?: TerminationReason;
  recoveryHint: string;
}

const SOURCE_UNAVAILABLE_PATTERNS = [
  /403\b/,
  /404\b/,
  /login\s+required/i,
  /unauthorized/i,
  /forbidden/i,
  /access\s+denied/i,
  /rate\s+limit/i,
];

const MODEL_LIMIT_PATTERNS = [
  /too\s+long/i,
  /context\s+(window|length|size)\s+exceed/i,
  /token\s+limit/i,
  /maximum\s+output/i,
  /cannot\s+(process|handle|complete)/i,
];

/**
 * Classify a hard-check failure into a recovery category.
 */
export function classifyHardCheckFailure(results: HardCheckResult[]): ClassifiedError {
  const failures = results.filter((r) => !r.passed);

  // Check for source-unavailable patterns in failure details
  for (const f of failures) {
    for (const pattern of SOURCE_UNAVAILABLE_PATTERNS) {
      if (pattern.test(f.detail)) {
        return {
          category: 'terminal',
          terminalReason: 'source_unavailable',
          recoveryHint: f.detail,
        };
      }
    }
  }

  return {
    category: 'recoverable',
    recoveryHint: failures.map((f) => f.detail).join('; '),
  };
}

/**
 * Classify an evaluator verdict into a recovery category.
 */
export function classifyEvalFailure(verdict: EvalVerdict): ClassifiedError {
  const issuesText = verdict.issues.join(' ');

  for (const pattern of MODEL_LIMIT_PATTERNS) {
    if (pattern.test(issuesText)) {
      return {
        category: 'terminal',
        terminalReason: 'model_capability_exceeded',
        recoveryHint: `Evaluator flags model limits: ${verdict.issues.join('; ')}`,
      };
    }
  }

  return {
    category: 'recoverable',
    recoveryHint: `Evaluator issues: ${verdict.issues.join('; ')}`,
  };
}

/**
 * Classify a generic error (e.g., from planner or runtime).
 */
export function classifyRuntimeError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);

  if (/plan/i.test(message) && /reject|fail|unable/i.test(message)) {
    return {
      category: 'terminal',
      terminalReason: 'plan_rejected',
      recoveryHint: message,
    };
  }

  return {
    category: 'recoverable',
    recoveryHint: message,
  };
}

// ── Root cause classification ──────────────────────────────────────────

export type RootCauseKind =
  | 'source_unavailable'
  | 'model_capability_exceeded'
  | 'information_unavailable'
  | 'network_transient'
  | 'quality_insufficient';

export interface RootCauseClassification {
  kind: RootCauseKind;
  userMessage: string;
  retryStrategy: 'fix-attempt' | 'awaiting_human' | 'terminal';
  terminalReason?: TerminationReason;
}

export function classifyRootCause(
  verdict: EvalVerdict | undefined,
  hardCheckResults: HardCheckResult[],
  diagnostics: WorkerDiagnostics | undefined,
): RootCauseClassification {
  if (diagnostics?.errorsCaught?.some((e) => /timeout|connection reset|ECONNRESET/i.test(e))) {
    return {
      kind: 'network_transient',
      userMessage: `Stage 执行过程中网络持续超时（${diagnostics.errorsCaught.length} 次错误）。建议：1) 检查网络 2) 更换数据源`,
      retryStrategy: 'fix-attempt',
    };
  }

  const sizeIssue = hardCheckResults.some((r) => /\d+ bytes, expected/i.test(r.detail));
  const urlsAllFailed = diagnostics?.urlsAttempted && diagnostics.urlsAttempted.length > 0 &&
    diagnostics.urlsAttempted.every((u) => /^4\d\d|^5\d\d|empty|no results/i.test(String(u.status)));
  if (sizeIssue && urlsAllFailed) {
    const terms = diagnostics?.searchedTerms?.join(', ') ?? '(unknown)';
    return {
      kind: 'information_unavailable',
      userMessage: `无法找到足够的相关资料来充实 Stage。已尝试关键词：${terms}。建议：1) 提供更具体方向 2) 更换数据源 3) 缩小范围`,
      retryStrategy: 'awaiting_human',
    };
  }

  return {
    kind: 'quality_insufficient',
    userMessage: verdict?.issues.join('; ') ?? hardCheckResults.filter((r) => !r.passed).map((r) => r.detail).join('; '),
    retryStrategy: 'fix-attempt',
  };
}
