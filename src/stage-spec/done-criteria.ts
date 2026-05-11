/**
 * Done-criteria evaluation against real artifacts.
 *
 * Runs hard checks for machine-checkable kinds.
 * free-form criteria always pass here — evaluator-deep handles them.
 */

import type { DoneCriterion, HardCheckResult } from '../coordinator/state.js';
import { artifactExists, readArtifact } from '../storage/artifact-store.js';

/**
 * Tolerance for minBytes checks. LLM output frequently lands 5-15% under target;
 * 0.75 is a pragmatic floor that catches gross under-production while accepting
 * minor shortfalls.
 */
const MIN_BYTES_TOLERANCE = 0.75;

/**
 * Evaluate a single done criterion against the filesystem.
 * Returns pass/fail with detail.
 */
export async function evaluateDoneCriterion(
  criterion: DoneCriterion,
  stateRoot: string,
  sagaId: string,
): Promise<HardCheckResult> {
  switch (criterion.kind) {
    case 'file-exists': {
      const relPath = String(criterion.path ?? '');
      const exists = await artifactExists(stateRoot, sagaId, relPath);
      if (!exists) {
        return { criterion, passed: false, detail: `file not found: ${relPath}` };
      }
      if (criterion.minBytes !== undefined) {
        const content = await readArtifact(stateRoot, sagaId, relPath);
        const size = content?.length ?? 0;
        const threshold = Math.floor((criterion.minBytes as number) * MIN_BYTES_TOLERANCE);
        if (size < threshold) {
          return {
            criterion,
            passed: false,
            detail: `file ${relPath} is ${size} bytes, expected ~${criterion.minBytes} (tolerance: >= ${threshold})`,
          };
        }
      }
      return { criterion, passed: true, detail: `file exists: ${relPath}` };
    }
    case 'file-size-gt': {
      const relPath = String(criterion.path ?? '');
      const minBytes = Number(criterion.minBytes ?? 0);
      const content = await readArtifact(stateRoot, sagaId, relPath);
      const size = content?.length ?? 0;
      const threshold = Math.floor(minBytes * MIN_BYTES_TOLERANCE);
      if (size < threshold) {
        return {
          criterion,
          passed: false,
          detail: `file ${relPath} is ${size} bytes, expected ~${minBytes} (tolerance: >= ${threshold})`,
        };
      }
      return { criterion, passed: true, detail: `file size ${size} bytes (target: ${minBytes})` };
    }
    case 'free-form': {
      // free-form always passes machine check — evaluator-deep judges quality
      return { criterion, passed: true, detail: 'free-form: deferred to evaluator-deep' };
    }
    default: {
      // Unknown kinds — soft-pass, let evaluator-deep handle
      return { criterion, passed: true, detail: `kind=${criterion.kind}: deferred` };
    }
  }
}

/**
 * Run all done-criteria for a stage.
 * Returns results for each criterion.
 */
export async function runDoneChecks(
  criteria: DoneCriterion[],
  stateRoot: string,
  sagaId: string,
): Promise<HardCheckResult[]> {
  const results: HardCheckResult[] = [];
  for (const c of criteria) {
    results.push(await evaluateDoneCriterion(c, stateRoot, sagaId));
  }
  return results;
}
