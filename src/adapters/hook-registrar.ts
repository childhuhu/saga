/**
 * Hook registrar — maps saga hooks onto OpenClaw lifecycle.
 *
 * Trigger is handled entirely by Mode B (skill routing).
 * Hooks only handle active saga context injection and authorization.
 */

import type { SagaState } from '../coordinator/state.js';

export interface HookContext {
  sessionId: string;
  agentId: string;
  sessionKey: string;
}

export interface BeforePromptBuildResult {
  injectSystemMessage?: string;
}

export interface BeforeToolCallResult {
  action: 'allow' | 'block';
  reason?: string;
}

export interface HookRegistrarDeps {
  readState(sagaId: string): Promise<SagaState | undefined>;
  activeSagaId(sessionId: string): Promise<string | undefined>;
}

// ── Hook handlers ──────────────────────────────────────────────────────

/**
 * before_prompt_build: inject context for active sagas.
 * Trigger is handled by skill routing (Mode B), not hooks.
 */
export async function handleBeforePromptBuild(
  ctx: HookContext,
  deps: HookRegistrarDeps,
  _prompt?: string,
): Promise<BeforePromptBuildResult> {
  const sagaId = await deps.activeSagaId(ctx.sessionId);
  if (!sagaId) return {};

  try {
    const state = await deps.readState(sagaId);
    if (!state || state.termination) return {};

    const stage = state.stages[state.cursor];
    if (!stage) return {};

    const transition = state.transition;
    if (
      transition?.kind === 'worker_mode_injected' ||
      transition?.kind === 'eval_needs_fix_attempt' ||
      transition?.kind === 'microcompact_retry' ||
      transition?.kind === 'rework_full'
    ) {
      const issues = 'issues' in transition ? transition.issues : [];
      const issuesBlock = issues.length > 0
        ? `\n\nPrevious attempt issues to address:\n${issues.map((i) => `- ${i}`).join('\n')}`
        : '';
      const hint = transition.kind === 'worker_mode_injected'
        ? ''
        : ` (revision needed — previous output failed evaluation)`;
      return {
        injectSystemMessage: `Saga ${sagaId} is active. You are in worker mode for stage "${stage.title}"${hint}. Call saga_advance with workerFinished=true when done.${issuesBlock}`,
      };
    }

    if (state.transition?.kind === 'eval_deep_pending') {
      return {
        injectSystemMessage: `Saga ${sagaId} needs your evaluation for stage "${stage.title}". Produce a JSON verdict: {"passed": true|false, "score": <number>, "issues": [...]}. Then call saga_advance with sagaId="${sagaId}" and evalResult=<your verdict>.`,
      };
    }
  } catch {
    // State not readable — skip injection
  }

  return {};
}

/**
 * before_tool_call: authorization guard.
 */
export async function handleBeforeToolCall(
  toolName: string,
  params: Record<string, unknown>,
  ctx: HookContext,
  deps: HookRegistrarDeps,
): Promise<BeforeToolCallResult> {
  if (toolName === 'saga_start') {
    const activeId = await deps.activeSagaId(ctx.sessionId);
    if (activeId) {
      return {
        action: 'block',
        reason: `Session already has active saga ${activeId}. Cancel or complete it first.`,
      };
    }
  }

  if (toolName === 'saga_advance') {
    if (!params.sagaId) {
      return {
        action: 'block',
        reason: 'saga_advance requires a sagaId parameter.',
      };
    }
  }

  return { action: 'allow' };
}
