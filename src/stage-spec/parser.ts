/**
 * Loose field-name parser for stage specs (C2).
 *
 * Accepts synonym field names and normalizes them.
 * Missing required fields return a structured "needs-supplement" signal,
 * never a hard error.
 */

import type { DoneCriterion } from '../coordinator/state.js';

// ── Synonym tables ───────────────────────────────────────────────────

const SIZE_SYNONYMS = ['bytes', 'minBytes', 'minSize', 'threshold', 'sizeMin', 'min-size', 'minBytes'] as const;
const PATH_SYNONYMS = ['path', 'filePath', 'file', 'location'] as const;
const DESC_SYNONYMS = ['desc', 'description', 'text', 'prompt', 'criteria'] as const;
const COMMAND_SYNONYMS = ['command', 'cmd', 'run', 'shell'] as const;
const PATTERN_SYNONYMS = ['pattern', 'regex', 'match', 'query'] as const;

function resolveSynonym(obj: Record<string, unknown>, synonyms: readonly string[]): unknown {
  for (const s of synonyms) {
    if (obj[s] !== undefined) return obj[s];
  }
  return undefined;
}

// ── Parse result ─────────────────────────────────────────────────────

export interface ParseDoneCriterionResult {
  normalized: DoneCriterion;
  missing: string[];
}

/**
 * Parse and normalize a single done-criterion from loose LLM output.
 * Returns normalized criterion + list of missing required fields.
 */
export function parseDoneCriterion(raw: Record<string, unknown>): ParseDoneCriterionResult {
  const kind = String(raw.kind ?? 'free-form');
  const missing: string[] = [];
  const normalized: DoneCriterion = { kind };

  switch (kind) {
    case 'file-exists': {
      const p = resolveSynonym(raw, PATH_SYNONYMS);
      if (p !== undefined) {
        normalized.path = String(p);
      } else {
        missing.push('path');
      }
      const minBytes = resolveSynonym(raw, SIZE_SYNONYMS);
      if (minBytes !== undefined) {
        normalized.minBytes = Number(minBytes);
      }
      break;
    }
    case 'file-size-gt': {
      const p = resolveSynonym(raw, PATH_SYNONYMS);
      if (p !== undefined) {
        normalized.path = String(p);
      } else {
        missing.push('path');
      }
      const minBytes = resolveSynonym(raw, SIZE_SYNONYMS);
      if (minBytes !== undefined) {
        normalized.minBytes = Number(minBytes);
      } else {
        missing.push('minBytes');
      }
      break;
    }
    case 'command': {
      const cmd = resolveSynonym(raw, COMMAND_SYNONYMS);
      if (cmd !== undefined) {
        normalized.command = String(cmd);
      } else {
        missing.push('command');
      }
      break;
    }
    case 'log-scan': {
      const p = resolveSynonym(raw, PATH_SYNONYMS);
      if (p !== undefined) {
        normalized.path = String(p);
      } else {
        missing.push('path');
      }
      const pattern = resolveSynonym(raw, PATTERN_SYNONYMS);
      if (pattern !== undefined) {
        normalized.pattern = String(pattern);
      }
      break;
    }
    case 'free-form': {
      const desc = resolveSynonym(raw, DESC_SYNONYMS);
      if (desc !== undefined) {
        normalized.desc = String(desc);
      }
      break;
    }
    default: {
      // Unknown kind — preserve all fields, let evaluator-deep handle
      Object.assign(normalized, raw);
      break;
    }
  }

  return { normalized, missing };
}

/**
 * Parse an array of done-criterion from loose LLM output.
 */
export function parseDoneCriteria(rawArray: unknown[]): ParseDoneCriterionResult[] {
  return rawArray.map((raw) => {
    if (typeof raw === 'object' && raw !== null) {
      return parseDoneCriterion(raw as Record<string, unknown>);
    }
    // Unparseable — treat as free-form
    return {
      normalized: { kind: 'free-form', desc: String(raw) },
      missing: [],
    };
  });
}

/**
 * Parse a stage spec from planner output.
 * Returns normalized stage data + any missing-field feedback.
 */
export interface ParsedStageSpec {
  id: string;
  title: string;
  goal: string;
  doneCriteria: DoneCriterion[];
  evaluatorMode: 'auto' | 'deep';
  missingFields: string[];
}

export function parseStageSpec(raw: Record<string, unknown>, index: number, profileDefault: 'auto' | 'deep' = 'auto'): ParsedStageSpec {
  const id = String(raw.id ?? `stage-${String(index + 1).padStart(2, '0')}`);
  const title = String(raw.title ?? raw.name ?? `Stage ${index + 1}`);
  const goal = String(raw.goal ?? raw.description ?? raw.objective ?? '');
  const evaluatorMode = raw.evaluator === 'deep' ? 'deep' : raw.evaluator === 'auto' ? 'auto' : profileDefault;

  const rawDone = raw.done ?? raw.doneCriteria ?? raw['done-criteria'] ?? raw.checks ?? [];
  const doneArray = Array.isArray(rawDone) ? rawDone : [];
  const parsedDone = parseDoneCriteria(doneArray);

  const missingFields: string[] = [];
  if (goal.length === 0) missingFields.push(`${id}: goal`);
  for (const p of parsedDone) {
    for (const m of p.missing) {
      missingFields.push(`${id}: done.${m}`);
    }
  }

  return {
    id,
    title,
    goal,
    doneCriteria: parsedDone.map((p) => p.normalized),
    evaluatorMode,
    missingFields,
  };
}
