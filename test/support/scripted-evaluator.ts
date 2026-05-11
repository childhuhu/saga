/**
 * Scripted evaluator helper for integration tests.
 *
 * Lets tests control what the evaluator returns on each rework round.
 * Returns canned evaluation responses in sequence from the provided array.
 */
import type { SubagentRunRequest, SubagentRunResult } from '../../src/sdk-port/subagent.js';

export interface ScriptedEvalResponse {
  action: string;
  issues?: string[];
}

/**
 * Create a scripted evaluator that returns responses in sequence.
 *
 * Each call to the returned function produces the next response.
 * When the array is exhausted, subsequent calls return { action: 'advance' }.
 */
export function makeScriptedEvaluator(responses: Array<ScriptedEvalResponse>) {
  let callIndex = 0;
  return (req: SubagentRunRequest): Promise<SubagentRunResult> => {
    const resp = responses[callIndex++] ?? { action: 'advance', issues: [] };
    const result: SubagentRunResult = {
      runId: `scripted-eval-${callIndex}`,
      status: 'completed',
      output: JSON.stringify({
        rubricScores: [
          {
            criterionId: 'completeness',
            score: resp.action === 'advance' ? 5 : 2,
            notes: resp.action === 'advance' ? 'All done' : 'Incomplete',
          },
          {
            criterionId: 'groundedness',
            score: resp.action === 'advance' ? 5 : 3,
            notes: resp.action === 'advance' ? 'Well grounded' : 'Needs work',
          },
          {
            criterionId: 'clarity',
            score: resp.action === 'advance' ? 5 : 4,
            notes: resp.action === 'advance' ? 'Very clear' : 'Acceptable',
          },
        ],
        issues: (resp.issues ?? []).map((msg, i) => ({
          id: `se-${i}`,
          severity: resp.action === 'block' ? 'blocker' : 'major',
          where: 'output',
          what: msg,
          evidence: [],
          suggestedFix: `Fix: ${msg}`,
        })),
        recommendedAction: resp.action,
      }),
      tokensUsed: 200,
      durationMs: 100,
    };
    return Promise.resolve(result);
  };
}
