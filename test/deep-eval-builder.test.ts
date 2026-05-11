/**
 * Deep eval builder — static contract and snapshot tests.
 *
 * Validates that buildDeepEvalPrompt renders checklist items from JSON
 * for every profile that uses deep evaluation.
 */

import { describe, it, expect } from 'vitest';
import { buildDeepEvalPrompt, parseDeepEvalVerdict } from '../src/roles/evaluator-deep.js';
import { getProfile } from '../src/profiles/index.js';
import { EvalChecklist } from '../src/profiles/checklist-schema.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const COMMON_INPUT = {
  stageId: 'stage-01',
  stageTitle: 'Test Stage',
  stageGoal: 'Test goal',
  doneCriteriaText: '- kind: file-exists, path: report.md',
  artifactContent: 'Test artifact content',
  fewShotExamples: '',
};

async function loadChecklist(profileId: string) {
  const jsonPath = path.join(ROOT, 'profiles', `${profileId}-default.json`);
  const raw = JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as Record<string, unknown>;
  return EvalChecklist.parse((raw.evaluator as Record<string, unknown>)?.checklist);
}

describe('deep eval builder — per-profile snapshots', () => {
  const deepProfiles = ['research', 'ops', 'review'];

  for (const profileId of deepProfiles) {
    it(`${profileId} prompt contains all H1–H3 and S1–S4 from JSON`, async () => {
      const checklist = await loadChecklist(profileId);
      const prompt = buildDeepEvalPrompt({
        ...COMMON_INPUT,
        profile: getProfile(profileId as 'research' | 'ops' | 'review'),
        checklist,
      });

      // Every hard item must appear with its title and descriptions
      for (const h of checklist.hard) {
        expect(prompt).toContain(`${h.id} — ${h.title}`);
        expect(prompt).toContain(h.passDescription);
        expect(prompt).toContain(h.failReworkDescription);
        expect(prompt).toContain(h.failEscalateDescription);
      }

      // Every soft item must appear with its title and weight
      for (const s of checklist.soft) {
        expect(prompt).toContain(`${s.id} — ${s.title}`);
        expect(prompt).toContain(String(s.weight));
        expect(prompt).toContain(s.scoringGuide);
      }

      // Checklist IDs must appear in the JSON output format section
      for (const h of checklist.hard) {
        expect(prompt).toContain(`"id": "${h.id}"`);
      }
    });
  }
});

describe('deep eval builder — JSON output format regression', () => {
  it('parseDeepEvalVerdict still works with data-driven prompt output', () => {
    const checklist = {
      hard: [{ id: 'H1', title: 'T', passDescription: 'p', failReworkDescription: 'r', failEscalateDescription: 'e' }],
      soft: [{ id: 'S1', title: 'T', weight: 1.0, scoringGuide: 'g' }],
    };
    const prompt = buildDeepEvalPrompt({
      ...COMMON_INPUT,
      profile: getProfile('research'),
      checklist,
    });

    // Verify the JSON template in the prompt is parseable
    const jsonMatch = prompt.match(/```json\s*\n([\s\S]*?)\n```/);
    expect(jsonMatch).toBeTruthy();

    // Simulate LLM filling in the template
    const filled = `{
      "checklist": [
        { "id": "H1", "status": "PASS", "evidence": "ok" },
        { "id": "S1", "score": 4, "notes": "good" }
      ],
      "passed": true,
      "escalate": false,
      "score": 4.0,
      "issues": []
    }`;
    const verdict = parseDeepEvalVerdict(filled);
    expect(verdict.passed).toBe(true);
    expect(verdict.score).toBe(4.0);
  });
});

describe('checklist Zod schema — validates all profile JSONs', () => {
  const allProfiles = ['research', 'ops', 'curation', 'review', 'generic'];

  for (const profileId of allProfiles) {
    it(`${profileId} checklist passes Zod validation`, async () => {
      const checklist = await loadChecklist(profileId);
      expect(checklist.hard.length).toBeGreaterThanOrEqual(1);
      expect(checklist.soft.length).toBeGreaterThanOrEqual(1);

      // Soft weights should sum to ~1.0
      const weightSum = checklist.soft.reduce((sum, s) => sum + s.weight, 0);
      expect(Math.abs(weightSum - 1.0)).toBeLessThan(0.05);

      // Hard IDs should be H1, H2, H3...
      for (let i = 0; i < checklist.hard.length; i++) {
        expect(checklist.hard[i]!.id).toBe(`H${i + 1}`);
      }
      // Soft IDs should be S1, S2, S3...
      for (let i = 0; i < checklist.soft.length; i++) {
        expect(checklist.soft[i]!.id).toBe(`S${i + 1}`);
      }
    });
  }
});
