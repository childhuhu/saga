/**
 * Evaluator-auto (§4.6).
 *
 * Runs in the `before_agent_finalize` hook context.
 * Synchronous hard-check execution — no sub-agent spawn.
 * Only handles machine-checkable kinds; free-form is deferred to evaluator-deep.
 */

import type { DoneCriterion, HardCheckResult } from '../coordinator/state.js';
import { runDoneChecks } from '../stage-spec/done-criteria.js';

export interface AutoEvalResult {
  passed: boolean;
  hardCheckResults: HardCheckResult[];
  machineCheckableCount: number;
  skippedCount: number;
}

/**
 * Run auto-evaluation: machine-checkable done criteria only.
 * free-form criteria are always marked as passed here — evaluator-deep handles them.
 */
export async function runAutoEval(
  criteria: DoneCriterion[],
  stateRoot: string,
  sagaId: string,
): Promise<AutoEvalResult> {
  const results = await runDoneChecks(criteria, stateRoot, sagaId);

  const machineResults = results.filter(
    (r) => r.criterion.kind !== 'free-form',
  );

  const allPassed = machineResults.every((r) => r.passed);

  return {
    passed: allPassed,
    hardCheckResults: results,
    machineCheckableCount: machineResults.length,
    skippedCount: results.length - machineResults.length,
  };
}
