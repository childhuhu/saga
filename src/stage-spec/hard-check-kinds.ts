/**
 * Hard-check kinds and their static traits.
 *
 * Used for partitioning checks into concurrent-read-only batches vs.
 * serial write batches (§4.5).
 */

export type HardCheckKind =
  | 'command'
  | 'file-exists'
  | 'file-schema'
  | 'file-size-gt'
  | 'progress-items'
  | 'browser'
  | 'log-scan'
  | 'metrics'
  | 'free-form';

export interface HardCheckTraits {
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
}

export const HARD_CHECK_TRAITS: Record<HardCheckKind, HardCheckTraits> = {
  'command':         { isReadOnly: false, isConcurrencySafe: false },
  'file-exists':     { isReadOnly: true,  isConcurrencySafe: true  },
  'file-schema':     { isReadOnly: true,  isConcurrencySafe: true  },
  'file-size-gt':    { isReadOnly: true,  isConcurrencySafe: true  },
  'progress-items':  { isReadOnly: true,  isConcurrencySafe: true  },
  'browser':         { isReadOnly: true,  isConcurrencySafe: false },
  'log-scan':        { isReadOnly: true,  isConcurrencySafe: true  },
  'metrics':         { isReadOnly: true,  isConcurrencySafe: true  },
  'free-form':       { isReadOnly: true,  isConcurrencySafe: true  },
};

/**
 * Partition criteria into readonly (can run concurrently) and
 * write batches (must run serially).
 */
export function partitionChecks<T extends { kind: string }>(
  criteria: T[],
): { readonly: T[]; write: T[] } {
  const readOnly: T[] = [];
  const write: T[] = [];
  for (const c of criteria) {
    const traits = HARD_CHECK_TRAITS[c.kind as HardCheckKind];
    if (traits && traits.isReadOnly) {
      readOnly.push(c);
    } else {
      write.push(c);
    }
  }
  return { readonly: readOnly, write };
}
