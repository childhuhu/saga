/**
 * Prompt loader — reads per-profile prompt fragments from disk.
 *
 * Files are in src/prompts/ (source of truth). The build script copies
 * .md files to dist/prompts/ so they're available at runtime.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProfileId } from '../coordinator/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPrompt(filename: string): string {
  try {
    return readFileSync(join(__dirname, filename), 'utf-8').trim();
  } catch {
    return '';
  }
}

export function loadPlannerPrompt(profile: string): string {
  const template = readPrompt('planner.md');
  const examples = readPrompt(`planner-examples-${profile}.md`);
  return template + '\n\n' + examples;
}

export function loadWorkerTools(profile: ProfileId): string {
  return readPrompt(`worker-tools-${profile}.md`);
}

export function promptFileExists(filename: string): boolean {
  try {
    readFileSync(join(__dirname, filename), 'utf-8');
    return true;
  } catch {
    return false;
  }
}
