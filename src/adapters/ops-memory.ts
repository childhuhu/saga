/**
 * Ops memory integration — appends a structured incident entry to
 * OpenClaw's active memory file on successful ops saga completion.
 *
 * Memory files are plain markdown at <workspace>/memory/YYYY-MM-DD.md.
 * Appending is safe per OpenClaw convention.
 */

import { join, dirname } from 'node:path';
import * as fs from 'node:fs/promises';
import { readArtifact } from '../storage/artifact-store.js';
import type { SagaState } from '../coordinator/state.js';

function workspaceDir(stateRoot: string): string {
  // stateRoot = <workspace>/saga/.saga → dirname twice = <workspace>
  return dirname(dirname(stateRoot));
}

export async function appendOpsMemoryEntry(
  stateRoot: string,
  state: SagaState,
): Promise<void> {
  if (state.profile !== 'ops') return;
  if (state.termination?.reason !== 'completed') return;

  const wsDir = workspaceDir(stateRoot);
  const today = new Date().toISOString().slice(0, 10);
  const memoryPath = join(wsDir, 'memory', `${today}.md`);

  // Read diagnosis.md and runbook.md from the last stage's artifacts
  const lastStage = state.stages[state.stages.length - 1];
  if (!lastStage) return;

  const diagRelPath = lastStage.doneCriteria
    .find(c => String(c.path ?? '').endsWith('diagnosis.md'))?.path;
  const runbookRelPath = lastStage.doneCriteria
    .find(c => String(c.path ?? '').endsWith('runbook.md'))?.path;

  const [diagnosis, runbook] = await Promise.all([
    diagRelPath ? readArtifact(stateRoot, state.sagaId, String(diagRelPath)) : '',
    runbookRelPath ? readArtifact(stateRoot, state.sagaId, String(runbookRelPath)) : '',
  ]);

  const symptom = (diagnosis || state.goal).split('\n\n')[0]!.slice(0, 100).replace(/\n/g, ' ');
  const firstDiag = (diagnosis || state.goal).split('\n\n')[0]!.slice(0, 200).replace(/\n/g, ' ');
  const runbookText = runbook ?? '';
  const firstCmd = runbookText.split('\n')
    .find(l => /^\s*(?:sudo |[\w/.]+\s)/.test(l.trim()))
    ?.slice(0, 200).replace(/\n/g, ' ')
    ?? '(see runbook.md)';
  const hasReverts = /revert/i.test(runbookText);

  const diagFile = diagRelPath ? String(diagRelPath) : '-';
  const runbookFile = runbookRelPath ? String(runbookRelPath) : '-';

  const entry = [
    `## ops-saga ${state.sagaId} — ${symptom}`,
    `- Diagnosis: ${firstDiag}`,
    `- Remediation: ${firstCmd}`,
    `- Reverts: ${hasReverts ? 'yes' : 'no'}`,
    `- Files: ${diagFile}, ${runbookFile}`,
    '',
  ].join('\n');

  await fs.mkdir(dirname(memoryPath), { recursive: true });
  const existing = await fs.readFile(memoryPath, 'utf-8').catch(() => '');
  await fs.writeFile(memoryPath, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + entry, 'utf-8');
}
