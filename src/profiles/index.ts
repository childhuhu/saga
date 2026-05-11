import type { ProfileId } from '../coordinator/state.js';
import type { HardCheckKind } from '../stage-spec/hard-check-kinds.js';

export interface ProfileDefinition {
  id: ProfileId;
  label: string;
  description: string;
  defaultEvaluatorMode: 'auto' | 'deep';
  allowedHardCheckKinds: HardCheckKind[];
  recommendedStageCount: { min: number; max: number };
  defaultClarificationRounds: number;
}

const PROFILES: Record<ProfileId, ProfileDefinition> = {
  ops: {
    id: 'ops', label: 'Ops',
    description: 'Home/personal infrastructure operations: diagnosis, configuration, remediation. Persistent memory of recurring issues. Command-based hard checks.',
    defaultEvaluatorMode: 'deep',
    allowedHardCheckKinds: ['command', 'file-exists', 'free-form'],
    recommendedStageCount: { min: 2, max: 5 },
    defaultClarificationRounds: 2,
  },
  research: {
    id: 'research', label: 'Research',
    description: 'Deep web/literature search with grounded reports. Heavy emphasis on source verification and rubric scoring.',
    defaultEvaluatorMode: 'deep',
    allowedHardCheckKinds: ['file-exists', 'file-size-gt', 'progress-items', 'free-form'],
    recommendedStageCount: { min: 2, max: 5 },
    defaultClarificationRounds: 2,
  },
  curation: {
    id: 'curation', label: 'Curation',
    description: 'Content organization, structured documentation, and schema-compliant output.',
    defaultEvaluatorMode: 'auto',
    allowedHardCheckKinds: ['file-exists', 'file-size-gt', 'file-schema', 'free-form'],
    recommendedStageCount: { min: 2, max: 4 },
    defaultClarificationRounds: 1,
  },
  review: {
    id: 'review', label: 'Review',
    description: 'Artifact review and quality assessment. Deep evaluation with external checks required.',
    defaultEvaluatorMode: 'deep',
    allowedHardCheckKinds: ['file-exists', 'free-form'],
    recommendedStageCount: { min: 2, max: 5 },
    defaultClarificationRounds: 1,
  },
  generic: {
    id: 'generic', label: 'Generic',
    description: 'Last-resort fallback for multi-step tasks that do not match a specialized domain. Still enforces multi-stage planning.',
    defaultEvaluatorMode: 'auto',
    allowedHardCheckKinds: ['file-exists', 'file-size-gt', 'command', 'file-schema', 'progress-items', 'free-form'],
    recommendedStageCount: { min: 2, max: 4 },
    defaultClarificationRounds: 1,
  },
};

export function getProfile(id: ProfileId) {
  return PROFILES[id];
}

export function allProfiles() {
  return Object.values(PROFILES);
}
