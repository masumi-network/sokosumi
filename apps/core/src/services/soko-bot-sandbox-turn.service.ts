import {
  isSokoBotCapability,
  SOKO_BOT_SANDBOX_CAPABILITIES,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "@/lib/soko-bot/action-receipts";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import {
  assertSokoBotInferenceRegion,
  sokoBotInferenceEvidence,
  sokoBotModelRequest,
} from "@/lib/soko-bot/model-policy";
import { sanitizePersistedValue } from "@/lib/soko-bot/persisted-value";
import { stopBotSandbox } from "@/lib/soko-bot/sandbox/sandbox-runtime";
import type { TurnTokenClaims } from "@/lib/soko-bot/sandbox/turn-token";
import {
  closeTurn,
  failTurn,
  finishTurn,
  type PreparedTurn,
  prepareTurn,
  RuntimeEventLog,
  runTurnTool,
  runtimeEvent,
  SOKO_BOT_MAX_STEPS,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import { resolveRunnableSokoBotVersion } from "@/services/soko-bot-version.service";

/**
 * Core's half of a turn whose loop runs in the bot's sandbox. The runner
 * holds no credential: every request reaches Core with a per-turn token the
 * sandbox network proxy adds, and everything that decides what the turn may
 * do — grants, receipts, the EU model policy, metering — stays here.
 */

const GATEWAY_LANGUAGE_MODEL_URL =
  "https://ai-gateway.vercel.sh/v4/ai/language-model";

export class SokoBotSandboxRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 502,
  ) {
    super(message);
    this.name = "SokoBotSandboxRequestError";
  }
}

function logFor(claims: TurnTokenClaims): RuntimeEventLog {
  return new RuntimeEventLog(claims.turnId, claims.sessionId);
}

async function authorizeTurn(claims: TurnTokenClaims) {
  const { sokoBotRuntimeService } = await import(
    "@/services/soko-bot-runtime.service"
  );
  try {
    return await sokoBotRuntimeService.authorize({
      sessionId: claims.sessionId,
      turnId: claims.turnId,
    });
  } catch (error) {
    // Cancelled, paused, expired: the runner stops on 409 without settling.
    throw new SokoBotSandboxRequestError(
      error instanceof Error ? error.message : "Turn is not active",
      409,
    );
  }
}

export interface SandboxTurnStart
  extends Omit<PreparedTurn, "inferenceRegion"> {
  message: string;
  deadlineAt: string;
  maxSteps: number;
}

/** What the runner needs to run the loop; records the turn as started. */
export async function startSandboxTurn(
  claims: TurnTokenClaims,
): Promise<SandboxTurnStart> {
  const log = logFor(claims);
  let prepared: PreparedTurn;
  try {
    prepared = await prepareTurn(claims.sessionId, claims.turnId, {
      sandbox: true,
    });
  } catch (error) {
    throw new SokoBotSandboxRequestError(
      error instanceof Error ? error.message : "Turn is not active",
      409,
    );
  }
  await log.append(
    runtimeEvent("session.started", { sessionId: claims.sessionId }),
  );
  await log.append(runtimeEvent("turn.started", { turnId: claims.turnId }));
  const stored = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: claims.turnId },
    select: { userMessage: true, deadlineAt: true },
  });
  await log.append(
    runtimeEvent("message.received", { message: stored.userMessage }),
  );
  const { inferenceRegion: _region, ...turn } = prepared;
  return {
    ...turn,
    message: stored.userMessage,
    deadlineAt: stored.deadlineAt.toISOString(),
    maxSteps: SOKO_BOT_MAX_STEPS,
  };
}

/** A Sokosumi tool call from the runner, executed and receipted by Core. */
export async function runSandboxTool(
  claims: TurnTokenClaims,
  input: { capability: string; toolCallId: string; toolInput: unknown },
): Promise<unknown> {
  if (
    !isSokoBotCapability(input.capability) ||
    (SOKO_BOT_SANDBOX_CAPABILITIES as readonly string[]).includes(
      input.capability,
    )
  ) {
    throw new SokoBotSandboxRequestError("Unknown Sokosumi tool", 400);
  }
  return runTurnTool({
    log: logFor(claims),
    sessionId: claims.sessionId,
    turnId: claims.turnId,
    capability: input.capability as SokoBotCapability,
    toolCallId: input.toolCallId,
    toolInput: input.toolInput,
  });
}

async function markUntrusted(
  log: RuntimeEventLog,
  turnId: string,
  source: string,
): Promise<void> {
  const already = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId, type: WEB_TAINT_EVENT },
    select: { id: true },
  });
  if (!already) await log.append(runtimeEvent(WEB_TAINT_EVENT, { source }));
}

/**
 * A sandbox tool is about to run. Recorded for the audit trail, and — for
 * anything but the plan — the turn is marked as having read untrusted input
 * before the tool runs, so nothing it returns can reach an external action.
 */
export async function recordSandboxAction(
  claims: TurnTokenClaims,
  input: { name: string; toolCallId: string; toolInput: unknown },
): Promise<void> {
  const authorized = await authorizeTurn(claims);
  if (
    !(SOKO_BOT_SANDBOX_CAPABILITIES as readonly string[]).includes(
      input.name,
    ) ||
    !authorized.grant.capabilities.includes(input.name as SokoBotCapability)
  ) {
    throw new SokoBotSandboxRequestError("Tool is not granted", 403);
  }
  const log = logFor(claims);
  if (input.name !== "update_plan")
    await markUntrusted(log, claims.turnId, input.name);
  await log.append(
    runtimeEvent("actions.requested", {
      actions: [
        {
          name: input.name,
          callId: input.toolCallId,
          input: sanitizePersistedValue(input.toolInput),
        },
      ],
    }),
  );
}

export async function recordSandboxActionResult(
  claims: TurnTokenClaims,
  input: { name: string; toolCallId: string },
): Promise<void> {
  await logFor(claims).append(
    runtimeEvent("action.result", {
      name: input.name,
      callId: input.toolCallId,
    }),
  );
}

function usageNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "total" in value)
    return usageNumber((value as { total: unknown }).total);
  return 0;
}

function usedWebSearch(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (part) =>
        part &&
        typeof part === "object" &&
        (part as { toolName?: unknown }).toolName === "web_search",
    )
  );
}

/**
 * One model call from the runner. Core owns the Gateway key and the EU
 * routing policy: the model must be the turn's version model, the routing
 * options are Core's whatever the runner sent, and the response is checked
 * for its region and metered here — the runner's own report is never trusted
 * for billing.
 */
export async function proxySandboxModelCall(
  claims: TurnTokenClaims,
  request: { headers: Headers; body: string },
): Promise<{ status: number; body: string }> {
  const authorized = await authorizeTurn(claims);
  const version = await resolveRunnableSokoBotVersion(
    authorized.turn.versionId ?? null,
  );
  const modelId = request.headers.get("ai-language-model-id");
  if (request.headers.get("ai-language-model-streaming") !== "false")
    throw new SokoBotSandboxRequestError("Streaming is not allowed", 400);
  if (modelId !== version.model)
    throw new SokoBotSandboxRequestError("Model is not this turn's", 403);
  const apiKey = getEnv().AI_GATEWAY_API_KEY;
  if (!apiKey)
    throw new SokoBotSandboxRequestError("Model access is not configured", 502);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(request.body) as Record<string, unknown>;
  } catch {
    throw new SokoBotSandboxRequestError("Invalid model request", 400);
  }
  const policy = sokoBotModelRequest({
    role: "agent",
    model: version.model,
    inferenceRegion: version.inferenceRegion,
  });
  const providerOptions = (payload.providerOptions ?? {}) as Record<
    string,
    unknown
  >;
  payload.providerOptions = {
    ...providerOptions,
    gateway: policy.providerOptions.gateway,
  };

  const log = logFor(claims);
  await log.append(runtimeEvent("step.started", { modelId: version.model }));
  const headers = new Headers({
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "ai-gateway-auth-method": "api-key",
  });
  for (const [key, value] of request.headers) {
    if (key.startsWith("ai-") && key !== "ai-gateway-auth-method")
      headers.set(key, value);
  }
  const upstream = await fetch(GATEWAY_LANGUAGE_MODEL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await upstream.text();
  if (!upstream.ok) return { status: upstream.status, body: text };

  const result = JSON.parse(text) as {
    usage?: { inputTokens?: unknown; outputTokens?: unknown };
    providerMetadata?: unknown;
    content?: unknown;
  };
  try {
    assertSokoBotInferenceRegion(result.providerMetadata);
  } catch (error) {
    throw new SokoBotSandboxRequestError(
      error instanceof Error ? error.message : "Inference region rejected",
      502,
    );
  }
  const inputUsage = result.usage?.inputTokens;
  await log.append(
    runtimeEvent("step.completed", {
      modelId: version.model,
      inference: sokoBotInferenceEvidence(result.providerMetadata),
      usage: {
        inputTokens: usageNumber(inputUsage),
        outputTokens: usageNumber(result.usage?.outputTokens),
        cacheReadTokens:
          inputUsage && typeof inputUsage === "object"
            ? usageNumber((inputUsage as { cacheRead?: unknown }).cacheRead)
            : 0,
        cacheWriteTokens:
          inputUsage && typeof inputUsage === "object"
            ? usageNumber((inputUsage as { cacheWrite?: unknown }).cacheWrite)
            : 0,
        costUsd: gatewayCostUsd(result.providerMetadata),
      },
    }),
  );
  if (usedWebSearch(result.content))
    await markUntrusted(log, claims.turnId, "web_search");
  return { status: 200, body: text };
}

async function sokoBotIdForTurn(turnId: string): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { sokoBotId: true },
  });
  return turn?.sokoBotId ?? null;
}

/** The loop finished: build the owner's answer, settle, park the sandbox. */
export async function completeSandboxTurn(
  claims: TurnTokenClaims,
  input: { text: string; finishReason: string },
): Promise<void> {
  const authorized = await authorizeTurn(claims);
  const log = logFor(claims);
  try {
    await finishTurn({
      log,
      turnId: claims.turnId,
      text: input.text,
      finishReason: input.finishReason,
      // Same rule the prompt was built with, so the answer is parsed the way
      // the model was told to write it.
      requiresActionProof: authorized.grant.capabilities.some((capability) =>
        ACTION_CAPABILITIES.has(capability),
      ),
    });
  } catch (error) {
    await failTurn(log, {
      code: error instanceof Error ? error.name : "finish_failed",
      message: error instanceof Error ? error.message : "Could not finish",
    });
  }
  await closeTurn(log, claims.turnId);
  const botId = await sokoBotIdForTurn(claims.turnId);
  if (botId) await stopBotSandbox(botId);
}

/** The loop failed inside the sandbox. */
export async function failSandboxTurn(
  claims: TurnTokenClaims,
  error: { code: string; message: string },
): Promise<void> {
  // A turn that was cancelled or expired meanwhile is settled elsewhere.
  await authorizeTurn(claims);
  const log = logFor(claims);
  await failTurn(log, error);
  await closeTurn(log, claims.turnId);
  const botId = await sokoBotIdForTurn(claims.turnId);
  if (botId) await stopBotSandbox(botId);
}
