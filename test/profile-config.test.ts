/**
 * Profile config sweep — validates that every profile in the TS registry
 * has a matching JSON profile, few-shot rubric, prompt files, and that
 * config values are consistent.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allProfiles, getProfile } from '../src/profiles/index.js';
import { EvalChecklist } from '../src/profiles/checklist-schema.js';
import { promptFileExists } from '../src/prompts/index.js';
import { HARD_CHECK_TRAITS } from '../src/stage-spec/hard-check-kinds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ALL_HARD_CHECK_KINDS = new Set(Object.keys(HARD_CHECK_TRAITS));

async function loadProfileJson(profileId: string) {
  const jsonPath = path.join(ROOT, 'profiles', `${profileId}-default.json`);
  return JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as Record<string, unknown>;
}

describe('profile config sweep', () => {
  const profiles = allProfiles();

  for (const profile of profiles) {
    describe(`${profile.id}`, () => {
      it('has a matching JSON profile file', async () => {
        const jsonPath = path.join(ROOT, 'profiles', `${profile.id}-default.json`);
        const exists = await fs.access(jsonPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });

      it('JSON domain matches profile id', async () => {
        const json = await loadProfileJson(profile.id);
        expect(json.domain).toBe(profile.id);
      });

      it('fewShotCalibrationPath resolves to an existing file', async () => {
        const json = await loadProfileJson(profile.id);
        const evaluator = json.evaluator as Record<string, unknown> | undefined;
        const rubricPath = evaluator?.fewShotCalibrationPath as string | undefined;
        expect(rubricPath).toBeTruthy();
        const fullPath = path.join(ROOT, rubricPath!);
        const exists = await fs.access(fullPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });

      it('allowedHardCheckKinds is a subset of valid kinds', () => {
        for (const kind of profile.allowedHardCheckKinds) {
          expect(ALL_HARD_CHECK_KINDS.has(kind)).toBe(true);
        }
      });

      it('has evaluator.checklist that passes Zod validation', async () => {
        const json = await loadProfileJson(profile.id);
        const evaluator = json.evaluator as Record<string, unknown>;
        expect(evaluator.checklist).toBeTruthy();
        const checklist = EvalChecklist.parse(evaluator.checklist);
        expect(checklist.hard.length).toBeGreaterThanOrEqual(1);
        expect(checklist.soft.length).toBeGreaterThanOrEqual(1);
      });

      it('has worker-tools and planner-examples prompt files', () => {
        expect(promptFileExists(`worker-tools-${profile.id}.md`)).toBe(true);
        expect(promptFileExists(`planner-examples-${profile.id}.md`)).toBe(true);
      });

      it('has a matching SKILL.md', async () => {
        const skillPath = path.join(ROOT, 'skills', `saga-${profile.id}`, 'SKILL.md');
        const exists = await fs.access(skillPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });
    });
  }

  it('generic profile also has all artifacts', async () => {
    const json = await loadProfileJson('generic');
    expect(json.domain).toBe('generic');
    const evaluator = json.evaluator as Record<string, unknown>;
    expect(evaluator.checklist).toBeTruthy();
    expect(promptFileExists('worker-tools-generic.md')).toBe(true);
    expect(promptFileExists('planner-examples-generic.md')).toBe(true);
    const skillPath = path.join(ROOT, 'skills', 'saga-generic', 'SKILL.md');
    const exists = await fs.access(skillPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
