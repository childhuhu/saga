/**
 * OpenClaw plugin entry point.
 * This is the ONLY file in src/ that knows about OpenClaw SDK types.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';

const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

import { createAllTools, type ToolDefinition, type SagaStartDeps } from './tool-registrar.js';
import { handleBeforePromptBuild, handleBeforeToolCall, type HookRegistrarDeps } from './hook-registrar.js';
import type { AdvanceDeps, SagaState, SagaEvent } from '../coordinator/state.js';
import { ensureSagaDir, writeState, readState as readStateFs } from '../storage/state-store.js';
import { appendEvent, readEvents as readEventsFs } from '../storage/events.js';
import { advance, createSaga } from '../coordinator/advance.js';
import { runDoneChecks } from '../stage-spec/done-criteria.js';
import { buildDeepEvalPrompt } from '../roles/evaluator-deep.js';
import { buildProgressSummary } from '../coordinator/progress.js';
import { readArtifact } from '../storage/artifact-store.js';
import type { Stage, HardCheckResult, EvalVerdict } from '../coordinator/state.js';
import { appendOpsMemoryEntry } from './ops-memory.js';
import { getProfile } from '../profiles/index.js';
import { EvalChecklist } from '../profiles/checklist-schema.js';

// ── OpenClaw SDK types (local mirror, avoids importing SDK at compile time) ──

interface SubagentApi {
  run(req: { sessionKey: string; message: string; model?: string; deliver?: boolean }): Promise<{ runId: string }>;
  waitForRun(req: { runId: string; timeoutMs: number }): Promise<{ status: string; error?: string }>;
  getSessionMessages(req: { sessionKey: string; limit?: number }): Promise<{ messages: unknown[] }>;
  deleteSession(req: { sessionKey: string }): Promise<void>;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  source: string;
  config: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
  version?: string;
  rootDir?: string;
  registrationMode?: string;
  logger: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  registerTool(tool: unknown, opts?: { optional?: boolean; names?: string[] }): void;
  registerCli(registrar: (ctx: { program: unknown }) => void, opts?: { commands?: string[]; descriptors?: unknown[] }): void;
  on(hookName: string, handler: (event: any, ctx: any) => any, opts?: { priority?: number }): void;
  resolvePath(input: string): string;
  enqueueNextTurnInjection?: (injection: {
    sessionKey: string;
    text: string;
    idempotencyKey?: string;
    placement?: string;
    ttlMs?: number;
  }) => Promise<{ enqueued: boolean; id: string }>;
  registerSessionExtension?: (ext: {
    namespace: string;
    description: string;
    project?: (ctx: { sessionKey: string; state: unknown }) => unknown;
    cleanup?: (ctx: { reason: string; sessionKey?: string }) => void | Promise<void>;
  }) => void;
  runtime?: {
    system?: {
      enqueueSystemEvent?: (text: string, opts: { sessionKey: string }) => void;
    };
    subagent?: SubagentApi;
    agent?: { runEmbeddedPiAgent?: (req: unknown) => Promise<unknown> };
    [key: string]: unknown;
  };
}

// ── Plugin config ────────────────────────────────────────────────────

interface SagaPluginConfig {
  stateRoot?: string;
}

// ── Session state tracking ───────────────────────────────────────────

let activeSessionKey = '';
const activeSagas = new Map<string, string>(); // sessionId → sagaId

// ── Plugin factory ───────────────────────────────────────────────────

export function createSagaPlugin(deps?: Partial<AdvanceDeps>, opts?: { stateRoot?: string }) {
  const stateRoot = opts?.stateRoot ?? join(process.cwd(), '.saga');

  return {
    stateRoot,

    /** Build deps using real storage + optional overrides */
    buildDeps(api: OpenClawPluginApi): SagaStartDeps {
      return {
        stateRoot,
        readState: (sagaId: string) => readStateFs(stateRoot, sagaId),
        writeState: (state: SagaState) => writeState(stateRoot, state),
        appendEvent: (sagaId: string, event: SagaEvent) => appendEvent(stateRoot, sagaId, event),

        runPlanner: deps?.runPlanner ?? (async (_goal, _profile) => {
          // Cannot spawn sub-agent from tool handler (RequestScopedSubagentRuntimeError).
          // Return empty plan — saga_start will return plan_required with planner prompt,
          // the main agent itself generates the plan, then submits via saga_advance.
          return { plan: { summary: '', stages: [] } };
        }),

        runEvaluator: deps?.runEvaluator ?? (async (_state: SagaState, stage: Stage): Promise<EvalVerdict> => {
          const results = await runDoneChecks(stage.doneCriteria, stateRoot, _state.sagaId);
          const machineResults = results.filter((r) => r.criterion.kind !== 'free-form');
          const allPassed = machineResults.length === 0 || machineResults.every((r) => r.passed);
          const failedDetails = results.filter((r) => !r.passed).map((r) => r.detail);
          return { passed: allPassed, issues: failedDetails, score: null };
        }),

        runHardChecks: deps?.runHardChecks ?? (async (stage: Stage, state: SagaState): Promise<HardCheckResult[]> => {
          return runDoneChecks(stage.doneCriteria, stateRoot, state.sagaId);
        }),

        buildDeepEvalPrompt: deps?.buildDeepEvalPrompt ?? (async (state: SagaState, stage: Stage): Promise<string> => {
          const profileDef = getProfile(state.profile);
          const paths = stage.doneCriteria
            .filter((c) => c.kind === 'file-exists' || c.kind === 'file-size-gt')
            .map((c) => String(c.path ?? ''));
          const contents = await Promise.all(paths.map(async (p) => {
            const c = await readArtifact(stateRoot, state.sagaId, p);
            return c ? `--- ${p} ---\n${c}\n\n` : '';
          }));
          const artifactContent = contents.join('') || '(No artifacts found)';
          const doneCriteriaText = stage.doneCriteria
            .map((c) => `- kind: ${c.kind}${c.path ? `, path: ${c.path}` : ''}${c.desc ? `, desc: ${c.desc}` : ''}`)
            .join('\n');

          // Load checklist from profile JSON
          const profileJsonPath = join(PLUGIN_ROOT, 'profiles', `${state.profile}-default.json`);
          const profileJson = JSON.parse(await fs.readFile(profileJsonPath, 'utf-8')) as Record<string, unknown>;
          const checklist = EvalChecklist.parse(
            (profileJson.evaluator as Record<string, unknown>)?.checklist,
          );

          // Load few-shot examples
          const fewShotPath = (profileJson.evaluator as Record<string, unknown>)?.fewShotCalibrationPath as string | undefined;
          let fewShotExamples = '';
          if (fewShotPath) {
            fewShotExamples = await fs.readFile(join(PLUGIN_ROOT, fewShotPath), 'utf-8').catch(() => '');
          }

          return buildDeepEvalPrompt({
            stageId: stage.id, stageTitle: stage.title, stageGoal: stage.goal,
            doneCriteriaText, artifactContent, profile: profileDef,
            fewShotExamples, checklist,
          });
        }),

        queueWorkerModeInjection: async (state: SagaState, stage) => {
          // Use enqueueNextTurnInjection if available
          if (api.enqueueNextTurnInjection && activeSessionKey) {
            await api.enqueueNextTurnInjection({
              sessionKey: activeSessionKey,
              text: buildWorkerModeText(state, stage),
              idempotencyKey: `${state.sagaId}:${stage.id}:${state.modeRevision}`,
              placement: 'prepend_context',
              ttlMs: 30 * 60 * 1000,
            });
          }
          // Also use enqueueSystemEvent as fallback for progress
          const enqueueEvent = api.runtime?.system?.enqueueSystemEvent;
          if (enqueueEvent && activeSessionKey) {
            const progress = buildProgressSummary(state);
            enqueueEvent(progress.display, { sessionKey: activeSessionKey });
          }
        },

        runClarifier: deps?.runClarifier ?? (async (_state: SagaState) => {
          return { questions: [] };
        }),

        readLatestDiagnostic: deps?.readLatestDiagnostic ?? (async (sagaId: string, stageId: string) => {
          const { readLatestDiagnostic: readDiag } = await import('../storage/diagnostic-store.js');
          return readDiag(stateRoot, sagaId, stageId);
        }),
      };
    },
  };
}

function buildWorkerModeText(state: SagaState, stage: Stage): string {
  const artifacts = stage.doneCriteria
    .filter((c) => c.kind === 'file-exists' || c.kind === 'file-size-gt')
    .map((c) => `- ${c.path ?? ''}${c.minBytes ? ` (min ${c.minBytes} bytes)` : ''}`);
  return [
    `## Saga Worker Mode: Stage "${stage.title}"`,
    `Saga ID: ${state.sagaId} | Stage: ${stage.id} | Goal: ${stage.goal}`,
    '',
    'Produce the required output, then call saga_advance with workerFinished=true and artifacts=[{path,content}].',
    'Required artifacts:', artifacts.length > 0 ? artifacts.join('\n') : '(none — free-form criteria only)',
    'IMPORTANT: Pass ALL artifacts in the artifacts parameter. Do NOT write files to disk.',
  ].join('\n');
}

// ── Plugin registration (called by OpenClaw gateway) ─────────────────

function toSnakeCase(name: string): string {
  return name.replace(/\./g, '_');
}

export default {
  id: 'saga',
  name: 'Saga Long-Running Harness',
  description: 'Continue-site coordinator for long-running tasks. Skill-routed trigger, loose schema, worker-as-injection.',

  register(api: OpenClawPluginApi) {
    if (api.registrationMode && api.registrationMode !== 'full') {
      return;
    }

    const config = (api.pluginConfig ?? {}) as SagaPluginConfig;
    // Default stateRoot: <openclaw-config>/.openclaw/workspace/saga/.saga
    // Derived by walking up two levels from the extension dir (extensions/saga/ → .openclaw/)
    // so user data is NOT inside the extension directory and survives plugin uninstall/upgrade.
    const extensionDir = api.rootDir ?? process.cwd();
    const defaultStateRoot = join(dirname(dirname(extensionDir)), 'workspace', 'saga', '.saga');
    const stateRoot = config.stateRoot ?? defaultStateRoot;

    // Startup validation: ensure stateRoot is writable
    fs.mkdir(stateRoot, { recursive: true })
      .then(() => fs.access(stateRoot, fs.constants.W_OK))
      .then(() => api.logger.info(`[saga] stateRoot=${stateRoot} writable`))
      .catch((err) => api.logger.error(`[saga] stateRoot=${stateRoot} not writable: ${err instanceof Error ? err.message : String(err)}`));

    const plugin = createSagaPlugin(undefined, { stateRoot });
    const deps = plugin.buildDeps(api);
    api.logger.info(`[saga] runtime.subagent available: ${!!api.runtime?.subagent}`);

    // ── Register tools ──────────────────────────────────────────────
    const tools = createAllTools(deps);

    for (const tool of tools) {
      const snakeName = toSnakeCase(tool.name);
      api.registerTool(
        (ctx: any) => ({
          name: snakeName,
          description: tool.description,
          parameters: tool.parametersSchema,
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            activeSessionKey = ctx?.sessionKey ?? '';
            const sessionId = ctx?.sessionId ?? '';

            // Track active saga per session
            if (params.sagaId) {
              activeSagas.set(sessionId, String(params.sagaId));
            }

            try {
              const result = await tool.handler(params, {
                sessionKey: activeSessionKey,
                agentId: ctx?.agentId ?? api.id,
                sessionId,
              });

              // Post-completion: ops memory entry
              const res = result as Record<string, unknown> | null;
              if (res?.nextAction === 'terminated' && res?.reason === 'completed') {
                const sagaId = String(params.sagaId ?? '');
                if (sagaId) {
                  deps.readState(sagaId)
                    .then(s => appendOpsMemoryEntry(stateRoot, s))
                    .catch(err => api.logger.warn(`[saga] ops memory append failed: ${err instanceof Error ? err.message : String(err)}`));
                }
              }

              return result;
            } finally {
              activeSessionKey = '';
            }
          },
        }),
        { names: [snakeName] },
      );
    }

    // ── Register hooks ──────────────────────────────────────────────

    const hookDeps: HookRegistrarDeps = {
      readState: async (sagaId: string) => {
        try {
          return await readStateFs(stateRoot, sagaId);
        } catch {
          return undefined;
        }
      },
      activeSagaId: async (sessionId: string) => activeSagas.get(sessionId),
    };

    api.on('before_prompt_build', async (event: { prompt: string }, hookCtx: any) => {
      const ctx = {
        sessionId: hookCtx?.sessionId ?? '',
        agentId: hookCtx?.agentId ?? '',
        sessionKey: hookCtx?.sessionKey ?? '',
      };
      const result = await handleBeforePromptBuild(ctx, hookDeps, event.prompt);
      if (result.injectSystemMessage) {
        return { prependContext: result.injectSystemMessage };
      }
      return undefined;
    });

    api.on('before_tool_call', async (...args: unknown[]) => {
      const [toolName, params, hookCtx] = args as [string, Record<string, unknown>, any];
      const ctx = {
        sessionId: hookCtx?.sessionId ?? '',
        agentId: hookCtx?.agentId ?? '',
        sessionKey: hookCtx?.sessionKey ?? '',
      };
      const result = await handleBeforeToolCall(toolName, params, ctx, hookDeps);
      if (result.action === 'block') {
        return { block: true, blockReason: result.reason };
      }
      return undefined;
    });

    // ── Register session extension (for saga state in UI) ───────────

    if (api.registerSessionExtension) {
      api.registerSessionExtension({
        namespace: 'saga',
        description: 'Saga long-running task state',
        project(ctx) {
          const sagaId = activeSagas.get(ctx.sessionKey ?? '');
          if (!sagaId) return undefined;
          // Return lightweight projection — don't read full state synchronously
          return { activeSagaId: sagaId };
        },
        cleanup(ctx) {
          if (ctx.reason === 'delete' || ctx.reason === 'reset') {
            activeSagas.delete(ctx.sessionKey ?? '');
          }
        },
      });
    }

    api.logger.info(`[saga] registered ${tools.length} tools, 2 hooks, session extension`);
  },
};
