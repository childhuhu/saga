import * as fs from 'node:fs/promises';
import type { SagaEvent } from '../coordinator/state.js';
import { eventsPath } from './state-store.js';

/**
 * Append an event to the saga's events.jsonl.
 * This is the single source of truth for crash-resume arbitration (§2.1.1).
 */
export async function appendEvent(stateRoot: string, sagaId: string, event: SagaEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n';
  await fs.appendFile(eventsPath(stateRoot, sagaId), line, 'utf-8');
}

/**
 * Read all events from events.jsonl.
 * Used for replay, crash-resume, and four-source arbitration.
 */
export async function readEvents(stateRoot: string, sagaId: string): Promise<SagaEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath(stateRoot, sagaId), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const events: SagaEvent[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(JSON.parse(trimmed) as SagaEvent);
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    console.warn(`[saga] readEvents(${sagaId}): skipped ${skipped} corrupt line(s)`);
  }
  return events;
}

/**
 * Read only the last event — used for four-source arbitration.
 */
export async function readTailEvent(stateRoot: string, sagaId: string): Promise<SagaEvent | undefined> {
  const events = await readEvents(stateRoot, sagaId);
  return events.at(-1);
}
