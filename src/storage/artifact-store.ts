import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stageArtifactDir, artifactsDir } from './state-store.js';

/**
 * Write an artifact file under the saga's artifacts/ directory.
 */
export async function writeArtifact(
  stateRoot: string,
  sagaId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(artifactsDir(stateRoot, sagaId), relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * Write a stage-level artifact (e.g., stage-01-report.md).
 */
export async function writeStageArtifact(
  stateRoot: string,
  sagaId: string,
  stageId: string,
  suffix: string,
  content: string,
): Promise<string> {
  const filename = `${stageId}-${suffix}`;
  const dir = stageArtifactDir(stateRoot, sagaId);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

/**
 * Read an artifact file. Returns undefined if not found.
 */
export async function readArtifact(
  stateRoot: string,
  sagaId: string,
  relativePath: string,
): Promise<string | undefined> {
  const fullPath = path.join(artifactsDir(stateRoot, sagaId), relativePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Check if an artifact file exists.
 */
export async function artifactExists(
  stateRoot: string,
  sagaId: string,
  relativePath: string,
): Promise<boolean> {
  const fullPath = path.join(artifactsDir(stateRoot, sagaId), relativePath);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}
