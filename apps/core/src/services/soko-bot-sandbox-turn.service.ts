import { z } from "@hono/zod-openapi";
import {
  isSokoBotCapability,
  isSokoBotSandboxCapability,
} from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  internalServerError,
} from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import {
  ACTION_CAPABILITIES,
  actionInputHash,
} from "@/lib/soko-bot/action-receipts";
import { gatewayCallUsage, gatewayRanTool } from "@/lib/soko-bot/gateway-cost";
import {
  assertSokoBotInferenceRegion,
  sokoBotInferenceEvidence,
  sokoBotModelRequest,
} from "@/lib/soko-bot/model-policy";
import {
  persistedToolResult,
  sanitizePersistedValue,
  truncateUtf8,
} from "@/lib/soko-bot/persisted-value";
import { stopTurnSandbox } from "@/lib/soko-bot/sandbox/sandbox-runtime";
import type { TurnTokenClaims } from "@/lib/soko-bot/sandbox/turn-token";
import {
  announceTurn,
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
 * Core's half of a turn whose loop runs in a sandbox VM. The runner holds no
 * credential: every request reaches Core with a per-turn token the sandbox
 * network proxy adds, and everything that decides what the turn may do —
 * grants, receipts, the EU model policy, metering — stays here.
 */

const GATEWAY_LANGUAGE_MODEL_URL =
  "https://ai-gateway.vercel.sh/v4/ai/language-model";

const modelRequestSchema = z.record(z.string(), z.unknown());

/** The Gateway protocol headers a model call may carry; nothing else passes. */
const FORWARDED_MODEL_HEADERS = [
  "ai-language-model-id",
  "ai-language-model-specification-version",
  "ai-language-model-streaming",
  "ai-gateway-protocol-version",
] as const;

function logFor(claims: TurnTokenClaims): RuntimeEventLog {
  return new RuntimeEventLog(claims.turnId, claims.sessionId);
}

/** Cancelled, paused or expired turns answer 409; the runner stops on it. */
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
    throw conflict(
      error instanceof Error ? error.message : "Turn is not active",
    );
  }
}

export interface SandboxTurnStart
  extends Omit<PreparedTurn, "inferenceRegion"> {
  message: string;
  deadlineAt: string;
  maxSteps: number;
}

/** What the runner needs to run the loop; records the turn as started once. */
export async function startSandboxTurn(
  claims: TurnTokenClaims,
): Promise<SandboxTurnStart> {
  let prepared: PreparedTurn;
  try {
    prepared = await prepareTurn(claims.sessionId, claims.turnId, {
      sandbox: true,
    });
  } catch (error) {
    throw conflict(
      error instanceof Error ? error.message : "Turn is not active",
    );
  }
  const started = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId: claims.turnId, type: "turn.started" },
    select: { id: true },
  });
  if (started) throw conflict("Turn already started");
  const stored = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: claims.turnId },
    select: { userMessage: true, deadlineAt: true },
  });
  await announceTurn(logFor(claims), stored.userMessage);
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
  const { capability } = input;
  if (
    !isSokoBotCapability(capability) ||
    isSokoBotSandboxCapability(capability)
  )
    throw badRequest("Unknown Sokosumi tool");
  return runTurnTool({
    log: logFor(claims),
    capability,
    toolCallId: input.toolCallId,
    toolInput: input.toolInput,
  });
}

async function markUntrusted(
  log: RuntimeEventLog,
  source: string,
): Promise<void> {
  const already = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId: log.turnId, type: WEB_TAINT_EVENT },
    select: { id: true },
  });
  if (!already) await log.append(runtimeEvent(WEB_TAINT_EVENT, { source }));
}

/**
 * A sandbox tool is about to run. Recorded for the audit trail, and — for
 * anything but the plan — the turn is marked as having read untrusted input
 * before the tool runs, so nothing it returns can reach an outward action.
 */
export async function recordSandboxAction(
  claims: TurnTokenClaims,
  input: { name: string; toolCallId: string; toolInput: unknown },
): Promise<void> {
  const authorized = await authorizeTurn(claims);
  if (
    !isSokoBotSandboxCapability(input.name) ||
    !authorized.grant.capabilities.includes(input.name)
  )
    throw forbidden("Tool is not granted");
  const log = logFor(claims);
  if (input.name !== "update_plan") await markUntrusted(log, input.name);
  // A tool-call row like Core's own tools, so what the bot read shows in the
  // turn's record. No actor bot: a read in the sandbox is never a receipt.
  await prisma.sokoBotToolCall.upsert({
    where: {
      turnId_toolCallId: {
        turnId: claims.turnId,
        toolCallId: input.toolCallId,
      },
    },
    create: {
      turnId: claims.turnId,
      toolCallId: input.toolCallId,
      capability: input.name,
      inputHash: actionInputHash(input.toolInput ?? null),
      input: persistedToolResult(input.toolInput ?? null),
    },
    update: {},
  });
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

const SANDBOX_OUTPUT_MAX_BYTES = 12_288;

export async function recordSandboxActionResult(
  claims: TurnTokenClaims,
  input: {
    name: string;
    toolCallId: string;
    status?: "completed" | "failed";
    output?: string;
    sources?: string[];
  },
): Promise<void> {
  await authorizeTurn(claims);
  if (!isSokoBotSandboxCapability(input.name))
    throw forbidden("Not a sandbox tool");
  const failed = input.status === "failed";
  await prisma.sokoBotToolCall.updateMany({
    where: {
      turnId: claims.turnId,
      toolCallId: input.toolCallId,
      // Only the row the runner recorded for this tool: a reused call id
      // must not settle one of Core's own calls.
      capability: input.name,
      status: "PENDING",
    },
    data: {
      status: failed ? "FAILED" : "COMPLETED",
      // The output is bounded on its own, so a long result can never crowd
      // out the sources the answer's citations are checked against.
      result: jsonInput(
        sanitizePersistedValue({
          output:
            input.output === undefined
              ? null
              : truncateUtf8(input.output, SANDBOX_OUTPUT_MAX_BYTES),
          sources: input.sources ?? [],
        }),
      ),
      ...(failed ? { errorDetail: input.output?.slice(0, 500) } : {}),
    },
  });
  await logFor(claims).append(
    runtimeEvent("action.result", {
      name: input.name,
      callId: input.toolCallId,
      ...(input.output === undefined
        ? {}
        : { output: sanitizePersistedValue(input.output) }),
    }),
  );
}

/**
 * One model call from the runner. Core owns the Gateway key and the EU
 * routing policy: only the turn's version model, only the Gateway protocol
 * headers, and Core's provider options in place of whatever the runner sent.
 * Usage is metered here — the runner's own report is never trusted — and
 * before the region check, so a rejected call is still billed.
 */
/**
 * The runner's web search: a call whose only tools are ones the Gateway runs
 * itself. Perplexity, which runs it, makes no zero-retention commitment, so
 * such a call keeps "no prompt training" but not zero retention. It carries
 * only the search terms; everything with the owner's data keeps both.
 */
function isGatewaySearchCall(payload: Record<string, unknown>): boolean {
  const tools = z
    .array(z.object({ type: z.literal("provider"), id: z.string() }))
    .min(1)
    .safeParse(payload.tools);
  return (
    tools.success && tools.data.every((tool) => tool.id.startsWith("gateway."))
  );
}

function withoutZeroRetention(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const { zeroDataRetention: _dropped, ...rest } = options;
  return rest;
}

export async function proxySandboxModelCall(
  claims: TurnTokenClaims,
  request: { headers: Headers; body: string },
): Promise<{ status: number; body: string }> {
  const authorized = await authorizeTurn(claims);
  const version = await resolveRunnableSokoBotVersion(
    authorized.turn.versionId ?? null,
  );
  if (request.headers.get("ai-language-model-streaming") !== "false")
    throw badRequest("Streaming is not allowed");
  if (request.headers.get("ai-language-model-id") !== version.model)
    throw forbidden("Model is not this turn's");
  const apiKey = getEnv().AI_GATEWAY_API_KEY;
  if (!apiKey) throw internalServerError("Model access is not configured");

  let payload: Record<string, unknown>;
  try {
    const parsed = modelRequestSchema.safeParse(JSON.parse(request.body));
    if (!parsed.success) throw new Error("not an object");
    payload = parsed.data;
  } catch {
    throw badRequest("Invalid model request");
  }
  const policy = sokoBotModelRequest({
    role: "agent",
    model: version.model,
    inferenceRegion: version.inferenceRegion,
  });
  payload.providerOptions = {
    gateway: isGatewaySearchCall(payload)
      ? withoutZeroRetention(policy.providerOptions.gateway)
      : policy.providerOptions.gateway,
  };

  const log = logFor(claims);
  await log.append(runtimeEvent("step.started", { modelId: version.model }));
  const headers = new Headers({
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "ai-gateway-auth-method": "api-key",
  });
  for (const name of FORWARDED_MODEL_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const upstream = await fetch(GATEWAY_LANGUAGE_MODEL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await upstream.text();
  if (!upstream.ok) return { status: upstream.status, body: text };

  let result: {
    usage?: { inputTokens?: unknown; outputTokens?: unknown };
    providerMetadata?: unknown;
    content?: unknown;
  };
  try {
    result = JSON.parse(text);
  } catch {
    throw badGateway("Unreadable model response");
  }
  await log.append(
    runtimeEvent("step.completed", {
      modelId: version.model,
      inference: sokoBotInferenceEvidence(result.providerMetadata),
      usage: gatewayCallUsage(result),
    }),
  );
  try {
    assertSokoBotInferenceRegion(result.providerMetadata, {
      model: version.model,
      role: "agent",
    });
  } catch (error) {
    throw badGateway(
      error instanceof Error ? error.message : "Inference region rejected",
    );
  }
  if (
    gatewayRanTool(result.content, "web_search") ||
    gatewayRanTool(result.content, "perplexity_search")
  )
    await markUntrusted(log, "web_search");
  return { status: 200, body: text };
}

/**
 * Settles the turn, then stops its VM. The next turn runs in a new VM and
 * first stops any VM still holding the bot's workspace, so the order here
 * cannot race it.
 */
async function settleAndStop(log: RuntimeEventLog): Promise<void> {
  await closeTurn(log, log.turnId);
  await stopTurnSandbox(log.turnId);
}

/** The loop finished: build the owner's answer and settle. */
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
  await settleAndStop(log);
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
  await settleAndStop(log);
}
