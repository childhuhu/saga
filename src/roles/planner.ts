/**
 * Planner role (§4.1).
 *
 * Spawns a read-only sub-agent with "write plan artifact" tools.
 * Parses the output using the loose stage-spec parser (C2).
 * Handles cascading: 1st fail → feedback, 2nd → shorten, 3rd → plan_rejected.
 */

import type { ProfileId, Plan, Stage } from '../coordinator/state.js';
import { parseStageSpec } from '../stage-spec/parser.js';

export interface PlannerOutput {
  summary: string;
  stages: Stage[];
  missingFields: string[];
}

/**
 * Parse planner output (markdown with embedded YAML stage specs) into a Plan.
 *
 * This is the loose-parsing path (C2): field names are normalized,
 * missing fields produce structured feedback, not hard errors.
 */
export function parsePlannerOutput(rawOutput: string, profileDefault?: 'auto' | 'deep'): PlannerOutput {
  const sections = rawOutput.split(/^##\s+/m).filter(Boolean);

  let summary = '';
  const stages: Stage[] = [];
  const missingFields: string[] = [];

  for (const section of sections) {
    // Extract summary from the first non-stage section
    if (/^Stage\s+\d|^S\d/i.test(section) === false && stages.length === 0) {
      summary = extractSummary(section);
      continue;
    }

    // Try to parse as a stage spec
    const yamlMatch = section.match(/```ya?ml\s*\n([\s\S]*?)```/);
    if (yamlMatch) {
      try {
        const yamlContent = yamlMatch[1]!;
        const parsed = parseYamlStage(yamlContent, stages.length, profileDefault);

        // Extract title from the heading line before the yaml block
        const titleMatch = section.match(/^Stage\s+\d+:?\s*(.+)/i);
        if (titleMatch && parsed.title === `Stage ${stages.length + 1}`) {
          parsed.title = titleMatch[1]!.trim();
        }

        // Extract goal from "Goal:" line
        const goalMatch = section.match(/Goal:\s*(.+)/i);
        if (goalMatch && parsed.goal.length === 0) {
          parsed.goal = goalMatch[1]!.trim();
        }

        stages.push({
          id: parsed.id,
          title: parsed.title,
          goal: parsed.goal,
          doneCriteria: parsed.doneCriteria.length > 0
            ? parsed.doneCriteria
            : [{ kind: 'free-form', desc: `Stage ${parsed.id} — no machine-checkable criteria` }],
          evaluatorMode: parsed.evaluatorMode,
        });
        missingFields.push(...parsed.missingFields);
      } catch {
        // Unparseable YAML — create a free-form stage
        stages.push({
          id: `stage-${String(stages.length + 1).padStart(2, '0')}`,
          title: `Stage ${stages.length + 1}`,
          goal: 'Goal could not be parsed from planner output',
          doneCriteria: [{ kind: 'free-form', desc: 'Planner output was unparseable' }],
          evaluatorMode: 'deep',
        });
      }
    }
  }

  return { summary, stages, missingFields };
}

function extractSummary(section: string): string {
  const lines = section.split('\n').filter((l) => l.trim().length > 0);
  // Skip heading line, take first substantive paragraph
  const body = lines.slice(1).join(' ').trim();
  return body.length > 500 ? body.slice(0, 497) + '...' : body;
}

/**
 * Minimal YAML parser for stage specs.
 * Handles flat key-value pairs + arrays of objects.
 * Does NOT require a full YAML library — planner output is structured enough.
 */
function parseYamlStage(yaml: string, index: number, profileDefault?: 'auto' | 'deep'): ReturnType<typeof parseStageSpec> {
  const lines = yaml.split('\n').map((l) => l.trim()).filter(Boolean);

  // Extract simple key-values
  const data: Record<string, unknown> = {};

  // Parse evaluator line
  for (const line of lines) {
    if (/^evaluator:/i.test(line)) {
      data.evaluator = line.split(':')[1]!.trim();
    }
  }

  // Parse done criteria array
  const doneStart = lines.findIndex((l) => /^done:/i.test(l));
  if (doneStart >= 0) {
    const criteria: Record<string, unknown>[] = [];
    let current: Record<string, unknown> | null = null;

    for (let i = doneStart + 1; i < lines.length; i++) {
      const line = lines[i]!;

      if (/^-\s+kind:/i.test(line)) {
        if (current) criteria.push(current);
        current = {};
        const kindMatch = line.match(/kind:\s*(.+)/i);
        if (kindMatch) current.kind = kindMatch[1]!.trim();
      } else if (current && line.includes(':')) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        if (key) current[key.trim()] = value;
      } else if (!/^\s/.test(lines[i - 1] ?? '') && current) {
        // End of array
        break;
      }
    }
    if (current) criteria.push(current);
    data.done = criteria;
  }

  return parseStageSpec(data, index, profileDefault);
}

/**
 * Build feedback for planner when stage spec has issues.
 * Used in cascading: 1st attempt asks planner to fix missing fields.
 */
export function buildPlannerFeedback(missingFields: string[]): string {
  if (missingFields.length === 0) return '';

  return `The plan has the following issues that need correction:\n${
    missingFields.map((f) => `- ${f}`).join('\n')
  }\n\nPlease revise the plan to include all required fields.`;
}
