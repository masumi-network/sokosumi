import { randomUUID } from "node:crypto";
import { z } from "@hono/zod-openapi";
import {
  isSokoBotCapability,
  isSokoBotSandboxCapability,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
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
import { withActiveBackgroundRuns } from "@/lib/soko-bot/active-background-runs";
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
  MODEL_CALL_MAX_MS,
  ModelStreamStalledError,
  readUntilIdle,
} from "@/lib/soko-bot/stream-model-call";
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
  sokoBotMaxSteps,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import { withTurnSkills } from "@/services/chat-message-skills.service";
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The reasoning-summary switches a runner request may carry, and nothing
 * else: a summary is what the provider chooses to show, never raw thoughts.
 * Replacing the whole `providerOptions` dropped these, so no bot reply ever
 * had a summary to show.
 */
export function reasoningSummaryOptions(
  value: unknown,
): Record<string, Record<string, unknown>> {
  const options = asRecord(value) ?? {};
  const out: Record<string, Record<string, unknown>> = {};
  const summary = asRecord(options.openai)?.reasoningSummary;
  if (summary === "auto" || summary === "detailed")
    out.openai = { reasoningSummary: summary };
  const thinking = asRecord(asRecord(options.google)?.thinkingConfig);
  if (thinking?.includeThoughts === true)
    out.google = { thinkingConfig: { includeThoughts: true } };
  return out;
}

function logFor(claims: TurnTokenClaims): RuntimeEventLog {
  return new RuntimeEventLog(claims.turnId, claims.sessionId);
}

/**
 * Cancelled, paused or expired turns answer 409 with this kind; the runner
 * stops on it. Any other 409, such as a write that lost a race, is only that
 * call's failure.
 */
function turnInactive(error: unknown) {
  return conflict(
    error instanceof Error ? error.message : "Turn is not active",
    {
      kind: CORE_API_ERROR_KINDS.SOKO_BOT_TURN_INACTIVE,
    },
  );
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
    throw turnInactive(error);
  }
}

export interface SandboxTurnStart
  extends Omit<PreparedTurn, "inferenceRegion"> {
  message: string;
  deadlineAt: string;
  maxSteps: number;
  background: boolean;
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
    throw turnInactive(error);
  }
  const started = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId: claims.turnId, type: "turn.started" },
    select: { id: true },
  });
  if (started) throw conflict("Turn already started");
  const stored = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: claims.turnId },
    select: {
      userMessage: true,
      deadlineAt: true,
      createdAt: true,
      parentTurnId: true,
    },
  });
  await announceTurn(logFor(claims), stored.userMessage);
  const { inferenceRegion: _region, ...turn } = prepared;
  return {
    ...turn,
    message: await withActiveBackgroundRuns(
      claims.turnId,
      await withTurnSkills(claims.turnId, stored.userMessage),
    ),
    deadlineAt: stored.deadlineAt.toISOString(),
    maxSteps: sokoBotMaxSteps(
      stored.deadlineAt.getTime() - stored.createdAt.getTime(),
    ),
    background: Boolean(stored.parentTurnId),
  };
}

/** A Sokosumi tool call from the runner, executed and receipted by Core. */
/**
 * A Core tool for the sandbox: the model's call, or a script's when there is
 * no `toolCallId`. A script's call gets its own id and the bare result.
 */
export async function runSandboxTool(
  claims: TurnTokenClaims,
  input: { capability: string; toolCallId?: string; toolInput: unknown },
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
    toolCallId: input.toolCallId ?? `script:${randomUUID()}`,
    toolInput: input.toolInput,
    cite: input.toolCallId !== undefined,
  });
}

/**
 * Sandbox tools that bring nothing new into the turn: the plan, and a file
 * the bot writes from what it already has. Anything that could have come from
 * the web was tainted when it was read; writing it down adds no input. Without
 * this, "write the notes and put them in my Files" was refused halfway.
 */
const SANDBOX_TOOLS_WITHOUT_INPUT = new Set(["update_plan", "workspace_write"]);

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
  if (!SANDBOX_TOOLS_WITHOUT_INPUT.has(input.name))
    await markUntrusted(log, input.name);
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
const SANDBOX_ERROR_DETAIL_MAX_BYTES = 1_000;

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
      // Redacted as Core's own tool errors are: a failed fetch can echo a URL
      // with a token in it, and this row is shown to the owner and the judge.
      ...(failed
        ? {
            errorDetail: truncateUtf8(
              redactSokoBotSensitiveText(input.output ?? ""),
              SANDBOX_ERROR_DETAIL_MAX_BYTES,
            ),
          }
        : {}),
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
 * The runner's web search, exactly as `searchWeb` sends it: the Gateway's
 * Perplexity tool forced, and one user message that is only the search
 * terms. Perplexity makes no zero-retention commitment, so this call keeps
 * "no prompt training" but not zero retention; anything else — a system
 * prompt, history, another tool — keeps both.
 */
const MAX_SEARCH_PROMPT_LENGTH = 1_000;
const gatewaySearchCallSchema = z.object({
  tools: z.tuple([
    z.object({
      type: z.literal("provider"),
      id: z.literal("gateway.perplexity_search"),
    }),
  ]),
  toolChoice: z.object({
    type: z.literal("tool"),
    toolName: z.literal("perplexity_search"),
  }),
  prompt: z.tuple([
    z.object({
      role: z.literal("user"),
      content: z.tuple([
        z.object({
          type: z.literal("text"),
          text: z
            .string()
            .startsWith("Search the web for: ")
            .max(MAX_SEARCH_PROMPT_LENGTH),
        }),
      ]),
    }),
  ]),
});

function isGatewaySearchCall(payload: Record<string, unknown>): boolean {
  return gatewaySearchCallSchema.safeParse(payload).success;
}

function withoutZeroRetention(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const { zeroDataRetention: _dropped, ...rest } = options;
  return rest;
}

const UNDICI_TIMEOUT_ERROR_NAMES = new Set([
  "HeadersTimeoutError",
  "TimeoutError",
  "ConnectTimeoutError",
  "BodyTimeoutError",
]);

function undiciErrorName(value: unknown): string | undefined {
  if (value instanceof Error) return value.name;
  if (value !== null && typeof value === "object" && "name" in value) {
    return typeof value.name === "string" ? value.name : undefined;
  }
  return undefined;
}

/** undici wraps connect/header/body timeouts as TypeError("fetch failed"). */
function isUndiciGatewayFetchFailure(error: unknown): boolean {
  if (error instanceof TypeError && error.message === "fetch failed") {
    return true;
  }
  const name = undiciErrorName(error);
  const causeName =
    error instanceof Error ? undiciErrorName(error.cause) : undefined;
  return (
    (name !== undefined && UNDICI_TIMEOUT_ERROR_NAMES.has(name)) ||
    (causeName !== undefined && UNDICI_TIMEOUT_ERROR_NAMES.has(causeName))
  );
}

/** The whole response body, failing fast if the stream goes silent. */
async function readBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of readUntilIdle(response.body))
    text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/**
 * The parts of a streamed Gateway answer, one JSON object per SSE `data:`
 * line; undefined when the body is not such a stream.
 */
function gatewayStreamParts(
  text: string,
): Record<string, unknown>[] | undefined {
  const parts: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const part = asRecord(JSON.parse(line.slice("data:".length)));
      if (!part) return undefined;
      parts.push(part);
    } catch {
      return undefined;
    }
  }
  return parts;
}

/**
 * One model call from the runner. Core owns the Gateway key and the EU
 * routing policy: only the turn's version model, only the Gateway protocol
 * headers, and Core's provider options in place of whatever the runner sent.
 * Usage is metered here — the runner's own report is never trusted — and
 * before the region check, so a rejected call is still billed.
 *
 * Calls stream, because the Gateway cuts a non-streamed call off at about 60
 * seconds. Core still reads the whole stream before the runner sees any of
 * it, so a tool call cannot run before its routing has been checked.
 */
export async function proxySandboxModelCall(
  claims: TurnTokenClaims,
  request: { headers: Headers; body: string },
): Promise<{ status: number; body: string; contentType: string }> {
  const authorized = await authorizeTurn(claims);
  const version = await resolveRunnableSokoBotVersion(
    authorized.turn.versionId ?? null,
  );
  if (request.headers.get("ai-language-model-streaming") !== "true")
    throw badRequest("Model calls must stream");
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
  const reasoning = reasoningSummaryOptions(payload.providerOptions);
  const gateway = isGatewaySearchCall(payload)
    ? withoutZeroRetention(policy.providerOptions.gateway)
    : policy.providerOptions.gateway;
  payload.providerOptions = {
    // The runner may only ask for a reasoning summary; routing, region and
    // retention stay Core's.
    ...reasoning,
    // No promptCacheKey or Gateway caching: "auto". Tried on the Personal
    // CRM run, the cache share fell from 43% to 26% and a step cost 3x.
    gateway,
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
  let upstream: Response;
  let text: string;
  try {
    upstream = await fetch(GATEWAY_LANGUAGE_MODEL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // Answer before Vercel kills the invocation, so the runner gets a 502
      // it retries instead of a 504 after five minutes.
      signal: AbortSignal.timeout(MODEL_CALL_MAX_MS),
    });
    text = await readBody(upstream);
  } catch (error) {
    if (error instanceof ModelStreamStalledError)
      throw Object.assign(badGateway(error.message), { cause: error });
    if (!isUndiciGatewayFetchFailure(error)) throw error;
    // No kind on this 502: keep the undici error as cause for Sentry's chain.
    throw Object.assign(
      badGateway("Model gateway timed out or is unreachable"),
      { cause: error },
    );
  }
  if (!upstream.ok)
    return {
      status: upstream.status,
      body: text,
      contentType: upstream.headers.get("content-type") ?? "application/json",
    };

  const parts = gatewayStreamParts(text);
  if (!parts) throw badGateway("Unreadable model response");
  // A stream that failed part-way has no finish: nothing to meter, and its
  // partial tool calls must not reach the runner.
  const finish = parts.findLast((part) => part.type === "finish");
  if (!finish) throw badGateway("Model stream ended without finishing");
  await log.append(
    runtimeEvent("step.completed", {
      modelId: version.model,
      inference: sokoBotInferenceEvidence(finish.providerMetadata),
      usage: gatewayCallUsage(finish),
    }),
  );
  try {
    assertSokoBotInferenceRegion(finish.providerMetadata, {
      model: version.model,
      role: "agent",
    });
  } catch (error) {
    throw badGateway(
      error instanceof Error ? error.message : "Inference region rejected",
    );
  }
  if (
    gatewayRanTool(parts, "web_search") ||
    gatewayRanTool(parts, "perplexity_search")
  )
    await markUntrusted(log, "web_search");
  return { status: 200, body: text, contentType: "text/event-stream" };
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
  input: { text: string; finishReason: string; reasoning?: string },
): Promise<void> {
  const authorized = await authorizeTurn(claims);
  const log = logFor(claims);
  try {
    // The provider's own summary, never raw chain of thought. The event
    // projection redacts and bounds it before it is stored.
    const reasoning = input.reasoning?.trim();
    if (reasoning) {
      await log.append(
        runtimeEvent("reasoning.completed", { text: reasoning }),
      );
    }
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
