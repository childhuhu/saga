/**
 * Tool registrar — registers saga_* tools with OpenClaw (§2.3).
 *
 * Tools: saga_start, saga_advance, saga_status, saga_resume, saga_cancel, saga_replay.
 * Each tool has a strict zod schema (C2 allows this — tools are LLM↔tool boundary).
 */

import type { SagaState, ProfileId } from '../coordinator/state.js';
import { createSaga, advance } from '../coordinator/advance.js';
import type { AdvanceDeps } from '../coordinator/state.js';
import { parsePlannerOutput } from '../roles/planner.js';
import { applyPlan, terminate } from '../coordinator/transitions.js';
import { ensureSagaDir } from '../storage/state-store.js';
import { writeArtifact } from '../storage/artifact-store.js';
import { writeDiagnostic } from '../storage/diagnostic-store.js';
import { buildProgressSummary } from '../coordinator/progress.js';
import { loadWorkerTools } from '../prompts/index.js';

export interface ToolContext {
  sessionKey: string;
  agentId: string;
  sessionId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface SagaStartDeps extends AdvanceDeps {
  stateRoot: string;
}

/** Artifact submitted by the worker alongside saga_advance(workerFinished=true) */
export interface ArtifactSubmission {
  path: string;
  content: string;
}

/**
 * Create the saga_start tool.
 */
export function createStartTool(deps: SagaStartDeps): ToolDefinition {
  return {
    name: 'saga_start',
    description: 'Start a new long-running saga for a complex task. Returns sagaId and initial plan.',
    parametersSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'The task goal in natural language' },
        profile: {
          type: 'string',
          enum: ['ops', 'research', 'curation', 'review', 'generic'],
          description: 'Domain profile for the saga',
        },
      },
      required: ['goal', 'profile'],
    },
    handler: async (params) => {
      const goal = String(params.goal);
      const profile = String(params.profile) as ProfileId;
      const sagaId = `saga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await ensureSagaDir(deps.stateRoot, sagaId);
      const state = await createSaga(sagaId, profile, goal, deps);
      const result = await advance({ sagaId }, deps);

      if (result.nextAction === 'await_human' && result.diagnostic?.includes('planYaml')) {
        return {
          sagaId: state.sagaId,
          status: 'plan_required',
          message: result.diagnostic,
          planPrompt: buildInlinePlanPrompt(goal, profile),
        };
      }

      return { sagaId: state.sagaId, status: 'started', nextAction: result, progress: buildProgressSummary(state) };
    },
  };
}

/**
 * Create the saga_advance tool.
 */
export function createAdvanceTool(deps: SagaStartDeps): ToolDefinition {
  return {
    name: 'saga_advance',
    description: 'Advance the saga by one step. Call when worker has finished a stage, to submit a plan, or to check current state. When workerFinished=true, include artifacts array with the output files.',
    parametersSchema: {
      type: 'object',
      properties: {
        sagaId: { type: 'string', description: 'The saga ID' },
        workerFinished: { type: 'boolean', description: 'Set true when stage work is complete' },
        humanInput: { type: 'string', description: 'Human-provided input after awaiting_human' },
        planYaml: { type: 'string', description: 'Markdown plan with embedded YAML stage specs (submit when saga_start returns plan_required)' },
        artifacts: {
          type: 'array',
          description: 'Artifact files produced by the worker. Each entry has path (relative to stage, e.g. stages/stage-01-report.md) and content.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
        evalResult: {
          type: 'object',
          description: 'Deep evaluation verdict. Submit after receiving eval_deep_required nextAction.',
          properties: {
            passed: { type: 'boolean' },
            score: { type: 'number' },
            issues: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['sagaId'],
    },
    handler: async (params) => {
      const sagaId = String(params.sagaId);
      const workerFinished = Boolean(params.workerFinished);
      const humanInput = params.humanInput ? String(params.humanInput) : undefined;

      if (params.planYaml) {
        const parsed = parsePlannerOutput(String(params.planYaml));
        if (parsed.stages.length === 0) {
          return { error: 'Plan parsing returned zero stages. Ensure plan has Stage headings with YAML done-criteria blocks.' };
        }
        const state = await deps.readState(sagaId);
        if (state.termination) state.termination = undefined;
        const updated = applyPlan(state, { summary: parsed.summary, stages: parsed.stages });
        await deps.writeState(updated);
        await deps.appendEvent(sagaId, {
          type: 'plan_produced', sagaId, stageCount: parsed.stages.length, stages: parsed.stages, summary: parsed.summary, ts: new Date().toISOString(),
        });
      }

      if (params.artifacts && Array.isArray(params.artifacts)) {
        for (const art of params.artifacts as ArtifactSubmission[]) {
          if (art.path && art.content) {
            await writeArtifact(deps.stateRoot, sagaId, String(art.path), String(art.content));
          }
        }
      }

      const evalResult = params.evalResult && typeof params.evalResult === 'object'
        ? {
            passed: Boolean((params.evalResult as Record<string, unknown>).passed),
            score: typeof (params.evalResult as Record<string, unknown>).score === 'number'
              ? (params.evalResult as Record<string, unknown>).score as number : null,
            issues: Array.isArray((params.evalResult as Record<string, unknown>).issues)
              ? ((params.evalResult as Record<string, unknown>).issues as unknown[]).map(String) : [],
            escalate: Boolean((params.evalResult as Record<string, unknown>).escalate),
          }
        : undefined;

      if (params.workerDiagnostics && workerFinished) {
        const diagState = await deps.readState(sagaId);
        const diagStage = diagState.stages[diagState.cursor];
        const diagAttempt = (diagState.recoveryAttempts[diagStage?.id ?? ''] ?? 0) + 1;
        if (diagStage) {
          await writeDiagnostic(deps.stateRoot, sagaId, diagStage.id, diagAttempt, params.workerDiagnostics as any);
        }
      }

      const result = await advance({ sagaId, workerFinished, humanInput, evalResult }, deps);
      const finalState = await deps.readState(sagaId);
      const base = { ...result, progress: buildProgressSummary(finalState) };

      if (result.nextAction === 'worker_mode_queued' || result.nextAction === 'revision_queued') {
        const stage = finalState.stages[finalState.cursor];
        if (stage) {
          const requiredFiles = stage.doneCriteria
            .filter((c) => c.kind === 'file-exists' || c.kind === 'file-size-gt')
            .map((c) => `  - ${c.path ?? ''}${(c as { minBytes?: number }).minBytes ? ` (min ${(c as { minBytes?: number }).minBytes} bytes)` : ''}`);
          const issues = result.nextAction === 'revision_queued' && 'reason' in result
            ? `\n\nPrevious attempt failed. Fix these issues:\n${result.reason}`
            : '';
          const stageNum = finalState.cursor + 1;
          const totalStages = finalState.stages.length;
          const progressTag = totalStages > 0 ? ` (${stageNum}/${totalStages})` : '';
          return {
            ...base,
            workerContext: [
              `## Worker Mode: Stage${progressTag} "${stage.title}"`,
              `Saga: ${sagaId} | Stage: ${stage.id}`,
              `Goal: ${stage.goal}${issues}`,
              '',
              'BEFORE starting work: tell the user in one line that you are beginning this stage.',
              'Example: "▶ Stage ' + stageNum + '/' + totalStages + ' 开始：' + stage.title + '"',
              '',
              'DO NOT end this conversation. Execute the stage task now:',
              loadWorkerTools(finalState.profile) || 'Use appropriate tools to complete the goal',
              'Call saga_advance(workerFinished=true, artifacts=[{path,content},...]) when done',
              ...(requiredFiles.length > 0 ? ['Required artifacts:', ...requiredFiles] : []),
              '',
              'AFTER saga_advance returns: tell the user in one line that this stage is done.',
              'Example: "✅ Stage ' + stageNum + '/' + totalStages + ' 完成：' + stage.title + '"',
            ].join('\n'),
          };
        }
      }

      return base;
    },
  };
}

/**
 * Create the saga_status tool.
 */
export function createStatusTool(readState: (sagaId: string) => Promise<SagaState>): ToolDefinition {
  return {
    name: 'saga_status',
    description: 'Read the current state of a saga, including stage progress and any recovery status.',
    parametersSchema: {
      type: 'object',
      properties: {
        sagaId: { type: 'string', description: 'The saga ID' },
      },
      required: ['sagaId'],
    },
    handler: async (params) => {
      const sagaId = String(params.sagaId);
      const state = await readState(sagaId);
      return {
        sagaId: state.sagaId, profile: state.profile, goal: state.goal,
        cursor: state.cursor, totalStages: state.stages.length,
        currentStage: state.stages[state.cursor]?.id ?? null,
        transition: state.transition?.kind ?? null,
        termination: state.termination ?? null,
        recoveryAttempts: state.recoveryAttempts,
        progress: buildProgressSummary(state),
      };
    },
  };
}

/**
 * Create the saga_cancel tool.
 */
export function createCancelTool(
  readState: (sagaId: string) => Promise<SagaState>,
  writeState: (state: SagaState) => Promise<void>,
): ToolDefinition {
  return {
    name: 'saga_cancel',
    description: 'Cancel a running saga.',
    parametersSchema: {
      type: 'object',
      properties: {
        sagaId: { type: 'string', description: 'The saga ID' },
        reason: { type: 'string', description: 'Optional cancellation reason' },
      },
      required: ['sagaId'],
    },
    handler: async (params) => {
      const sagaId = String(params.sagaId);
      const reason = params.reason ? String(params.reason) : 'Cancelled by user';
      const state = await readState(sagaId);

      if (state.termination) {
        return { error: `Saga ${sagaId} already terminated: ${state.termination.reason}` };
      }

      state.termination = terminate('aborted_by_user', reason);
      await writeState(state);
      return { sagaId, status: 'cancelled', reason };
    },
  };
}

/**
 * All tool definitions for registration.
 */
export function createAllTools(deps: SagaStartDeps): ToolDefinition[] {
  return [
    createStartTool(deps),
    createAdvanceTool(deps),
    createStatusTool(deps.readState),
    createCancelTool(deps.readState, deps.writeState),
  ];
}

function buildInlinePlanPrompt(goal: string, profile: string): string {
  return `Generate a ${profile} plan for: "${goal}"

Break into 2-4 stages. Each stage must have: ## Stage N: <title> heading, Goal: <description>, and a \`\`\`yaml block with done: array and evaluator: auto|deep.
Done criteria kinds: file-exists (with path), file-size-gt, command, free-form (with desc). Paths relative to artifacts dir.

Example:
## Stage 1: Gather sources
Goal: Find and verify sources.
\`\`\`yaml
done:
  - kind: file-exists
    path: stages/stage-01-report.md
    minBytes: 1000
evaluator: auto
\`\`\``;
}
