/**
 * Prompt coverage — every profile in PROFILES must have matching
 * worker-tools and planner-examples prompt files.
 */

import { describe, it, expect } from 'vitest';
import { allProfiles } from '../src/profiles/index.js';
import { promptFileExists } from '../src/prompts/index.js';

describe('prompt coverage', () => {
  const profiles = allProfiles();

  for (const profile of profiles) {
    it(`${profile.id} has worker-tools-${profile.id}.md`, () => {
      expect(promptFileExists(`worker-tools-${profile.id}.md`)).toBe(true);
    });

    it(`${profile.id} has planner-examples-${profile.id}.md`, () => {
      expect(promptFileExists(`planner-examples-${profile.id}.md`)).toBe(true);
    });
  }

  it('generic profile also has prompt files (not in PROFILES registry)', () => {
    expect(promptFileExists('worker-tools-generic.md')).toBe(true);
    expect(promptFileExists('planner-examples-generic.md')).toBe(true);
  });
});
