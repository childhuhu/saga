import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sagaDir } from './state-store.js';
import type { WorkerDiagnostics } from '../coordinator/state.js';

export async function writeDiagnostic(
  stateRoot: string,
  sagaId: string,
  stageId: string,
  attempt: number,
  data: WorkerDiagnostics,
): Promise<void> {
  const dir = path.join(sagaDir(stateRoot, sagaId), 'diagnostics');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${stageId}-attempt-${attempt}.json`),
    JSON.stringify(data, null, 2),
  );
}

export async function readLatestDiagnostic(
  stateRoot: string,
  sagaId: string,
  stageId: string,
): Promise<WorkerDiagnostics | undefined> {
  const dir = path.join(sagaDir(stateRoot, sagaId), 'diagnostics');
  try {
    const files = await fs.readdir(dir);
    const matching = files
      .filter((f) => f.startsWith(`${stageId}-attempt-`))
      .sort();
    if (matching.length === 0) return undefined;
    const latest = matching[matching.length - 1]!;
    const content = await fs.readFile(path.join(dir, latest), 'utf-8');
    return JSON.parse(content) as WorkerDiagnostics;
  } catch {
    return undefined;
  }
}
