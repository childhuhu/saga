/**
 * Cache prefix builder (§4.7, C5).
 *
 * Assembles prompts in stable-prefix → profile-suffix → stage-dynamic order
 * to maximize prompt cache hit rate across sagas and stages.
 */

import type { ProfileId } from '../coordinator/state.js';
import type { DoneCriterion } from '../coordinator/state.js';
import type { CollapsedEntry } from './context-collapse.js';

export interface PrefixConfig {
  stablePrefix: string;
  profileSuffix: string;
  stageDynamic: string;
}

/**
 * Build the cache-stable prompt assembly.
 *
 * [STABLE PREFIX, ~2000 tokens, shared across sagas and profiles]
 * [PROFILE SUFFIX, ~500 tokens, shared across sagas within same profile]
 * [STAGE DYNAMIC, changes every stage]
 */
export function assemblePrompt(config: PrefixConfig): string {
  return `${config.stablePrefix}\n\n${config.profileSuffix}\n\n${config.stageDynamic}`;
}

/**
 * Build the stage-dynamic section for worker mode injection.
 */
export function buildStageDynamic(opts: {
  sagaId: string;
  stageId: string;
  stageTitle: string;
  stageGoal: string;
  doneCriteria: DoneCriterion[];
  compactedHistory: CollapsedEntry[];
}): string {
  const criteriaText = opts.doneCriteria
    .map((c) => `- kind: ${c.kind}${c.path ? `, path: ${String(c.path)}` : ''}`)
    .join('\n');

  const historyLines = opts.compactedHistory.length > 0
    ? '\n### Completed Stages\n' + opts.compactedHistory
        .map((e) => {
          if (e.level === 'summary') return e.line;
          if (e.level === 'compact') return `Stage ${e.stageId}: ${e.data.verdict} (score ${e.data.score ?? 'n/a'}) — ${e.data.summary}`;
          return `Stage ${e.stageId}: full eval available`;
        })
        .join('\n')
    : '';

  return `### Stage Details
- Saga ID: ${opts.sagaId}
- Stage ID: ${opts.stageId}
- Title: ${opts.stageTitle}
- Goal: ${opts.stageGoal}

### Done Criteria
${criteriaText}
${historyLines}`;
}

/**
 * Profile-specific suffixes. Shared across all sagas of the same profile.
 */
const PROFILE_SUFFIXES: Record<ProfileId, string> = {
  ops: '## Ops Profile\n- Actions: diagnose network/device issues, configure infrastructure, write runbooks\n- Criteria: command (diagnostics), file-exists, free-form\n- Artifacts: diagnosis.md, runbook.md, memory entries',
  research: '## Research Profile\n- Actions: web/literature search, synthesize findings, write reports\n- Criteria: file-exists, free-form (groundedness rubric)\n- Artifacts: research reports, source lists',
  curation: '## Curation Profile\n- Actions: organize content, write structured documents\n- Criteria: file-schema, file-size-gt\n- Artifacts: curated collections, index files',
  review: '## Review Profile\n- Actions: read artifacts, assess quality, write issue lists\n- Criteria: free-form (quality rubric), external check\n- Artifacts: review reports, issue lists',
  generic: '## Generic Profile\n- Actions: any multi-step task, inventory, checklists, auditing\n- Criteria: all kinds\n- Artifacts: per-plan declaration',
};

export function getProfileSuffix(profile: ProfileId): string {
  return PROFILE_SUFFIXES[profile] ?? '';
}
