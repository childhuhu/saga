/**
 * Evaluator-deep — data-driven checklist builder.
 *
 * Reads the evaluator checklist (H1–H3 hard + S1–S4 soft) from profile JSON
 * and renders a single template. No per-profile branches.
 */

import type { ProfileDefinition } from '../profiles/index.js';
import type { EvalVerdict } from '../coordinator/state.js';

export interface DeepEvalInput {
  stageId: string;
  stageTitle: string;
  stageGoal: string;
  doneCriteriaText: string;
  artifactContent: string;
  profile: ProfileDefinition;
  fewShotExamples: string;
  checklist: import('../profiles/checklist-schema.js').EvalChecklistType;
}

// ── Public entry point ─────────────────────────────────────────────────────

export function buildDeepEvalPrompt(input: DeepEvalInput): string {
  const { checklist } = input;

  const hardSection = checklist.hard
    .map(h => `**${h.id} — ${h.title}**
- PASS: ${h.passDescription}
- FAIL-REWORK: ${h.failReworkDescription}
- FAIL-ESCALATE: ${h.failEscalateDescription}`)
    .join('\n\n');

  const softSection = checklist.soft
    .map(s => `**${s.id} — ${s.title}** (weight ${s.weight})
${s.scoringGuide}`)
    .join('\n\n');

  const checklistIds = [
    ...checklist.hard.map(h => `{ "id": "${h.id}", "status": "PASS|FAIL-REWORK|FAIL-ESCALATE", "evidence": "<one-sentence quote or finding>" }`),
    ...checklist.soft.map(s => `{ "id": "${s.id}", "score": 1-5, "notes": "<one sentence>" }`),
  ];

  return `You are the quality evaluator for this ${input.profile.label} stage output. Your job is to work through a concrete checklist — not give subjective scores.

## Stage being evaluated
- Stage ID: ${input.stageId}
- Title: ${input.stageTitle}
- Goal: ${input.stageGoal}

## Done criteria (what the worker was asked to produce)
${input.doneCriteriaText}

## Output to evaluate
${input.artifactContent}

## Few-shot calibration
${input.fewShotExamples || '(none)'}

---

## Evaluation checklist

Work through each item in order. For each, give a status and one-sentence evidence quote from the output.

### HARD items — ALL must pass for the stage to advance
If any hard item fails, you must decide: is it **rework** (achievable with more effort) or **escalate** (structurally impossible given available information)?

${hardSection}

### SOFT items — scored 1–5, affect overall quality
(These do not alone trigger rework or escalate)

${softSection}

---

## How to determine your verdict

1. If ALL hard items are PASS → **passed: true**
2. If any hard item is FAIL-REWORK → **passed: false, escalate: false** (trigger rework)
3. If any hard item is FAIL-ESCALATE (even one) → **passed: false, escalate: true** (pause for human)
   - Use escalate only when you are confident the information is genuinely unavailable or the criterion is structurally impossible, NOT just because the current output is poor.

Soft item scores determine the overall score (1–5 weighted average). Score does not affect pass/fail by itself.

---

## Output format

Produce ONLY this JSON (no prose before or after):

\`\`\`json
{
  "checklist": [
${checklistIds.map(s => '    ' + s).join(',\n')}
  ],
  "passed": true|false,
  "escalate": true|false,
  "score": <soft weighted average 1-5>,
  "issues": ["<specific issue 1>", "<specific issue 2>"]
}
\`\`\``;
}

// ── Verdict parser ─────────────────────────────────────────────────────────

export function parseDeepEvalVerdict(raw: string): EvalVerdict {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { passed: false, escalate: false, issues: ['Deep evaluator output was not valid JSON'], score: null };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return {
      passed: Boolean(parsed.passed),
      escalate: Boolean(parsed.escalate),
      score: typeof parsed.score === 'number' ? parsed.score : null,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    };
  } catch {
    return { passed: false, escalate: false, issues: ['Failed to parse deep evaluator JSON'], score: null };
  }
}
