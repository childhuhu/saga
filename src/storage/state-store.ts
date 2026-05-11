import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SagaState } from '../coordinator/state.js';

// ── Path helpers ──────────────────────────────────────────────────────

function runsDir(stateRoot: string): string { return path.join(stateRoot, 'runs') }
function sagaDir(stateRoot: string, sagaId: string): string { return path.join(runsDir(stateRoot), sagaId) }
function statePath(stateRoot: string, sagaId: string): string { return path.join(sagaDir(stateRoot, sagaId), 'state.json') }
function eventsPath(stateRoot: string, sagaId: string): string { return path.join(sagaDir(stateRoot, sagaId), 'events.jsonl') }
function artifactsDir(stateRoot: string, sagaId: string): string { return path.join(sagaDir(stateRoot, sagaId), 'artifacts') }
function stageArtifactDir(stateRoot: string, sagaId: string): string { return path.join(artifactsDir(stateRoot, sagaId), 'stages') }

export { runsDir, sagaDir, statePath, eventsPath, artifactsDir, stageArtifactDir }

// ── State store ───────────────────────────────────────────────────────

export class StateCorruptedError extends Error {
  constructor(public readonly sagaId: string, cause: unknown) {
    super(`State corrupted for saga ${sagaId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.cause = cause;
  }
}

export async function ensureSagaDir(stateRoot: string, sagaId: string): Promise<void> {
  const dir = sagaDir(stateRoot, sagaId);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'artifacts', 'stages'), { recursive: true });
}

export async function readState(stateRoot: string, sagaId: string): Promise<SagaState> {
  const fp = statePath(stateRoot, sagaId);
  let raw: string;
  try {
    raw = await fs.readFile(fp, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err;
    throw new StateCorruptedError(sagaId, err);
  }
  try {
    return JSON.parse(raw) as SagaState;
  } catch (err) {
    throw new StateCorruptedError(sagaId, err);
  }
}

export async function writeState(stateRoot: string, state: SagaState): Promise<void> {
  const fp = statePath(stateRoot, state.sagaId);
  const tmp = `${fp}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, fp);
}
