import { randomUUID } from "node:crypto";
import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import {
  getSokoBotVersion,
  isSokoBotCapability,
  isSokoBotSandboxCapability,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  internalServerError,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import { reportAiGatewayBudgetFailure } from "@/lib/ai-gateway-budget";
import { aiGatewayBudgetScopeFromBody } from "@/lib/ai-gateway-budget-error";
import { aiGatewayApiKey } from "@/lib/ai-gateway-purpose";
import { loadSokoBotTurnPurpose } from "@/lib/ai-gateway-turn-purpose";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { actionInputHash } from "@/lib/soko-bot/action-receipts";
import { gatewayCallUsage, gatewayRanTool } from "@/lib/soko-bot/gateway-cost";
import { recordModelCall } from "@/lib/soko-bot/model-calls";
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
import {
  logRunnerDiagnostic,
  type RunnerDiagnostic,
} from "@/lib/soko-bot/runner-log-events";
import { stopTurnSandbox } from "@/lib/soko-bot/sandbox/sandbox-runtime";
import type { TurnTokenClaims } from "@/lib/soko-bot/sandbox/turn-token";
import {
  MODEL_CALL_MAX_MS,
  ModelStreamStalledError,
  promptCacheTtlOptions,
  readUntilIdle,
} from "@/lib/soko-bot/stream-model-call";
import {
  announceTurn,
  changeTools,
  closeTurn,
  failTurn,
  finishTurn,
  isTaintBlocked,
  offeredCapabilities,
  type PreparedTurn,
  prepareTurn,
  RuntimeEventLog,
  runTurnTool,
  runtimeEvent,
  SokoBotTaintedActionError,
  sokoBotInputTokenBudget,
  sokoBotMaxSteps,
  turnRequiresActionProof,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import {
  turnReasoningEffortOptions,
  turnRunModel,
} from "@/lib/soko-bot/turn-model";
import {
  modelUserMessage,
  withReplyLanguage,
} from "@/lib/soko-bot/turn-model-context";
import { wellFormed } from "@/lib/soko-bot/well-formed";
import {
  type SokoBotSandboxShell,
  sandboxShellFor,
  sandboxShellNote,
} from "@/services/soko-bot-secrets.service";
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

/** A prompt cache key as `prepareTurn` makes it: version id and hash. */
const PROMPT_CACHE_KEY = /^[\w.-]{1,40}:[0-9a-f]{16}$/;

/**
 * The reasoning-summary switches a runner request may carry, and its prompt
 * cache key, and nothing else: a summary is what the provider chooses to
 * show, never raw thoughts.
 * Replacing the whole `providerOptions` dropped these, so no bot reply ever
 * had a summary to show.
 */
export function reasoningSummaryOptions(
  value: unknown,
  model: string,
): Record<string, Record<string, unknown>> {
  const options = asRecord(value) ?? {};
  const out: Record<string, Record<string, unknown>> = {};
  const openai = asRecord(options.openai);
  const summary = openai?.reasoningSummary;
  if (summary === "auto" || summary === "detailed")
    out.openai = { reasoningSummary: summary };
  // A version with one fixed system prompt and tool set keys its cache;
  // Core sets the retention.
  const cacheKey = openai?.promptCacheKey;
  if (typeof cacheKey === "string" && PROMPT_CACHE_KEY.test(cacheKey))
    out.openai = {
      ...out.openai,
      promptCacheKey: cacheKey,
      ...promptCacheTtlOptions(model),
    };
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
  extends Omit<
    PreparedTurn,
    "inferenceRegion" | "meetingPrep" | "granted" | "requestPlan"
  > {
  message: string;
  deadlineAt: string;
  budgetMs: number;
  maxSteps: number;
  inputTokenBudget: number;
  background: boolean;
  /** The owner's setup commands and allowed keys, when this turn has a shell. */
  shell?: SokoBotSandboxShell;
  /** Tools whose completed call Core records as a change (planLoop). */
  changeTools?: string[];
}

/** What the runner needs to run the loop; records the turn as started once. */
export async function startSandboxTurn(
  claims: TurnTokenClaims,
): Promise<SandboxTurnStart> {
  let prepared: PreparedTurn;
  let replyLanguage: string | null;
  try {
    [prepared, replyLanguage] = await withReplyLanguage(
      claims.turnId,
      prepareTurn(claims.sessionId, claims.turnId, { sandbox: true }),
    );
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
      sokoBotId: true,
      source: true,
      versionId: true,
    },
  });
  await announceTurn(logFor(claims), stored.userMessage);
  const {
    inferenceRegion: _region,
    meetingPrep: _meetingPrep,
    // Already in the message below; the runner needs only planInherited.
    requestPlan: _requestPlan,
    granted,
    ...turn
  } = prepared;
  const shell = await sandboxShellFor(stored.sokoBotId, granted);
  const shellNote = shell ? sandboxShellNote(shell) : null;
  const message = await modelUserMessage(
    prepared,
    stored.userMessage,
    replyLanguage,
  );
  return {
    ...turn,
    message: shellNote ? `${message}\n\n${shellNote}` : message,
    ...(shell ? { shell } : {}),
    ...(turn.planLoop || turn.cmoApplyChanges
      ? { changeTools: [...changeTools()] }
      : {}),
    deadlineAt: stored.deadlineAt.toISOString(),
    budgetMs: Math.max(
      30_000,
      stored.deadlineAt.getTime() - (await databaseNow()).getTime() - 20_000,
    ),
    maxSteps: sokoBotMaxSteps(
      stored.deadlineAt.getTime() - stored.createdAt.getTime(),
    ),
    inputTokenBudget: sokoBotInputTokenBudget({
      source: stored.source,
      cmo: getSokoBotVersion(stored.versionId).profile === "cmo",
      background: Boolean(stored.parentTurnId),
    }),
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
  // Search runs in Core, straight against the search API, not as a model call.
  if (capability === "web_search") {
    const { runCoreWebTool } = await import("@/lib/soko-bot/core-web-tools");
    return runCoreWebTool({
      sessionId: claims.sessionId,
      turnId: claims.turnId,
      capability,
      toolCallId: input.toolCallId ?? `script:${randomUUID()}`,
      toolInput: input.toolInput,
    });
  }
  // A planLoop version's plan is Core's; Core refuses it on any other.
  if (
    !isSokoBotCapability(capability) ||
    (isSokoBotSandboxCapability(capability) && capability !== "update_plan")
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
 * The runner asks about the turn's plan (planLoop): with a draft answer, the
 * done check; without one, the open steps for a nudge or the time-up report.
 */
export async function sandboxPlanNote(
  claims: TurnTokenClaims,
  input: { draft?: string },
): Promise<string | null> {
  await authorizeTurn(claims);
  const { evaluateTurnDoneCheck, openStepsNote } = await import(
    "@/lib/soko-bot/done-check"
  );
  return input.draft === undefined
    ? openStepsNote(claims.turnId)
    : evaluateTurnDoneCheck({
        turnId: claims.turnId,
        sessionId: claims.sessionId,
        draft: input.draft,
      });
}

const MAX_UPLOADS_PER_TURN = 20;
const UPLOAD_RESERVED_EVENT = "sandbox.upload_reserved";

/** Where the runner downloads a Files file for workspace_import_file. */
export async function sandboxFileSource(
  claims: TurnTokenClaims,
  fileId: string,
) {
  const authorized = await authorizeTurn(claims);
  const { sokoBotRuntimeService } = await import(
    "@/services/soko-bot-runtime.service"
  );
  try {
    return await sokoBotRuntimeService.workspaceFileSource(authorized, fileId);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "File not available",
    );
  }
}

/**
 * A one-time storage address for a file the runner is about to upload from
 * the workspace; upload_file accepts only addresses this turn was granted.
 */
export async function grantSandboxUpload(
  claims: TurnTokenClaims,
  input: {
    filename: string;
    folder?: string;
    contentType?: string;
    size: number;
  },
) {
  const authorized = await authorizeTurn(claims);
  const { sokoBotRuntimeService, WORKSPACE_UPLOAD_GRANTED_EVENT } =
    await import("@/services/soko-bot-runtime.service");
  // The same gates upload_file has: refused after taint where it would be,
  // and a bounded number per turn.
  if (await isTaintBlocked(claims.turnId, "upload_file"))
    throw unprocessableEntity(
      new SokoBotTaintedActionError("upload_file").message,
    );
  // Reserve, then count: the event log appends one at a time, so requests
  // sent together cannot all see room for one more.
  await logFor(claims).append(runtimeEvent(UPLOAD_RESERVED_EVENT, {}));
  const reserved = await prisma.sokoBotRuntimeEvent.count({
    where: { turnId: claims.turnId, type: UPLOAD_RESERVED_EVENT },
  });
  if (reserved > MAX_UPLOADS_PER_TURN)
    throw unprocessableEntity(
      `A turn can save up to ${MAX_UPLOADS_PER_TURN} workspace files`,
    );
  try {
    const granted = await sokoBotRuntimeService.grantWorkspaceUpload(
      authorized,
      input,
    );
    await logFor(claims).append(
      runtimeEvent(WORKSPACE_UPLOAD_GRANTED_EVENT, {
        pathname: granted.grant.pathname,
        displayName: granted.displayName,
        folder: granted.folder,
        contentType: granted.contentType,
      }),
    );
    return {
      uploadUrl: granted.grant.uploadUrl,
      headers: granted.grant.headers,
      pathname: granted.grant.pathname,
    };
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Upload not allowed",
    );
  }
}

/**
 * Sandbox tools that bring nothing new into the turn: the plan, and a file
 * the bot writes from what it already has. Anything that could have come from
 * the web was tainted when it was read; writing it down adds no input. Without
 * this, "write the notes and put them in my Files" was refused halfway.
 */
const SANDBOX_TOOLS_WITHOUT_INPUT = new Set([
  "update_plan",
  "workspace_write",
  // The owner's own Files, which read_file opens without taint too.
  "workspace_import_file",
]);

async function markUntrusted(
  log: RuntimeEventLog,
  source: string,
): Promise<void> {
  // One event per source: a write to an MCP server checks that nothing but
  // that server has put outside text into the turn (ADR 0074).
  const already = await prisma.sokoBotRuntimeEvent.findFirst({
    where: {
      turnId: log.turnId,
      type: WEB_TAINT_EVENT,
      data: { path: ["source"], equals: source },
    },
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

function gatewayBudgetScopeFromResponse(text: string) {
  try {
    return aiGatewayBudgetScopeFromBody(JSON.parse(text));
  } catch {
    // Non-JSON upstream failures are passed through to the SDK.
  }
}

/**
 * One model call from the runner. Core owns the Gateway key and the EU
 * routing policy: only the turn's model, only the Gateway protocol
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
  const model = turnRunModel(version, authorized.turn.modelId);
  if (request.headers.get("ai-language-model-id") !== model)
    throw forbidden("Model is not this turn's");
  const purpose = await loadSokoBotTurnPurpose(claims.turnId);
  const apiKey = aiGatewayApiKey(purpose);
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
    model,
    inferenceRegion: version.inferenceRegion,
    purpose,
  });
  const summary = reasoningSummaryOptions(payload.providerOptions, model);
  const effort = turnReasoningEffortOptions({
    version,
    model,
    complexity: authorized.complexity,
  });
  const reasoning = {
    ...summary,
    ...(effort.openai
      ? { openai: { ...summary.openai, ...effort.openai } }
      : {}),
  };
  payload.providerOptions = {
    // The runner may only ask for a reasoning summary and a well-formed
    // prompt cache key; routing, region, retention and effort stay Core's.
    ...reasoning,
    // No Gateway caching: "auto". A promptCacheKey only comes from a version
    // whose system prompt and tools stay the same across turns: tried while
    // the packet sat in the system prompt (the Personal CRM run), a key
    // dropped the cache share from 43% to 26%.
    gateway: policy.providerOptions.gateway,
  };

  const log = logFor(claims);
  await log.append(runtimeEvent("step.started", { modelId: model }));
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
      body: JSON.stringify(wellFormed(payload)),
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
  if (!upstream.ok) {
    const budgetScope = gatewayBudgetScopeFromResponse(text);
    if (budgetScope) {
      await reportAiGatewayBudgetFailure(budgetScope, purpose, apiKey);
    }
    return {
      status: upstream.status,
      body: text,
      contentType: upstream.headers.get("content-type") ?? "application/json",
    };
  }

  const parts = gatewayStreamParts(text);
  if (!parts) throw badGateway("Unreadable model response");
  // A stream that failed part-way has no finish: nothing to meter, and its
  // partial tool calls must not reach the runner.
  const finish = parts.findLast((part) => part.type === "finish");
  if (!finish) throw badGateway("Model stream ended without finishing");
  const ranSearch =
    gatewayRanTool(parts, "web_search") ||
    gatewayRanTool(parts, "perplexity_search");
  await log.append(
    runtimeEvent("step.completed", {
      // A search runs in its own model call; its spend shows as search.
      modelId: ranSearch ? "web_search" : model,
      inference: sokoBotInferenceEvidence(finish.providerMetadata),
      usage: gatewayCallUsage(finish),
    }),
  );
  await recordModelCall({
    turnId: claims.turnId,
    role: ranSearch ? "search" : "agent",
    requestedModel: model,
    providerMetadata: finish.providerMetadata,
    usage: gatewayCallUsage(finish),
  });
  try {
    assertSokoBotInferenceRegion(finish.providerMetadata, {
      model,
      role: "agent",
    });
  } catch (error) {
    throw badGateway(
      error instanceof Error ? error.message : "Inference region rejected",
    );
  }
  if (ranSearch) await markUntrusted(log, "web_search");
  return { status: 200, body: text, contentType: "text/event-stream" };
}

/**
 * Settles the turn, then stops its VM. The next turn runs in a new VM and
 * first stops any VM still holding the bot's workspace, so the order here
 * cannot race it.
 */
async function settleAndStop(
  log: RuntimeEventLog,
  launchLeaseToken: string | undefined,
): Promise<void> {
  await closeTurn(log, launchLeaseToken);
  await stopTurnSandbox(log.turnId);
}

/**
 * One model step's reasoning summary, kept on the turn as it arrives so the
 * chat shows it while the bot works. It is the provider's own summary, never
 * raw chain of thought; the event projection redacts and bounds it before it
 * is stored.
 */
export async function recordSandboxReasoning(
  claims: TurnTokenClaims,
  text: string,
): Promise<void> {
  await authorizeTurn(claims);
  const summary = text.trim();
  if (!summary) return;
  await logFor(claims).append(
    runtimeEvent("reasoning.completed", { text: summary }),
  );
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
      // Same tools and rule the prompt was built with, so the answer is
      // parsed the way the model was told to write it.
      requiresActionProof: turnRequiresActionProof(
        offeredCapabilities(
          await resolveRunnableSokoBotVersion(
            authorized.turn.versionId ?? null,
          ),
          authorized,
          { sandbox: true },
        ),
      ),
    });
  } catch (error) {
    await failTurn(log, {
      code: error instanceof Error ? error.name : "finish_failed",
      message: error instanceof Error ? error.message : "Could not finish",
    });
  }
  await settleAndStop(log, claims.reconciliationLeaseToken);
}

/**
 * The loop failed inside the sandbox. A runner's `diagnostic` reaches Core's
 * drain once per turn: the report that claims the live turn's
 * `runnerDiagnosticAt` logs it, before the sandbox is stopped.
 */
export async function failSandboxTurn(
  claims: TurnTokenClaims,
  error: { code: string; message: string },
  diagnostic?: RunnerDiagnostic,
): Promise<void> {
  // A turn that was cancelled or expired meanwhile is settled elsewhere.
  await authorizeTurn(claims);
  const log = logFor(claims);
  const started = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId: claims.turnId, type: "turn.started" },
    select: { id: true },
  });
  // The drain skips everything before a turn's start, so a runner that died
  // before starting has to be announced or its failure settles nothing.
  if (!started) {
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: claims.turnId },
      select: { userMessage: true },
    });
    await announceTurn(log, turn.userMessage).catch(() => undefined);
  }
  // A runner that died after its answer reached Core changes nothing: the
  // outcome already recorded stands, and only its settling is finished here.
  const failure = runtimeEvent("turn.failed", { ...error });
  // Not turn.cancelled: deadline cleanup appends it too, without the owner
  // asking, and an expired turn keeps its failure. An owner's cancellation
  // always commits the row first, so the row below decides it.
  const outcomes = ["turn.completed", "turn.failed"];
  // Authorization passed before the lock, so a cancellation can commit in
  // between. Writing the row waits for a cancellation in flight; one that
  // committed first leaves the turn to settle CANCELLED.
  const live = async (tx: Prisma.TransactionClient) => {
    const { count } = await tx.sokoBotTurn.updateMany({
      where: {
        id: claims.turnId,
        status: { in: ["STARTING", "RUNNING"] },
        cancellationRequestedAt: null,
      },
      data: { updatedAt: new Date() },
    });
    return count === 1;
  };
  // The diagnostic's claim commits with the failure, so the report that
  // failed the turn owns it before anyone can settle the turn. The claim is
  // on the turn's row, which outlives the session's events, and holds only
  // while the turn is live and not being cancelled.
  let claimed = false;
  const liveAndClaim = async (tx: Prisma.TransactionClient) => {
    if (!(await live(tx))) return false;
    const { count } = await tx.sokoBotTurn.updateMany({
      where: { id: claims.turnId, runnerDiagnosticAt: null },
      data: { runnerDiagnosticAt: new Date() },
    });
    claimed = count === 1;
    return true;
  };
  const failed = await log
    .appendUnless(failure, outcomes, diagnostic ? liveAndClaim : live)
    .catch(() => {
      // A claim that broke the write must not keep the turn from failing.
      claimed = false;
      return diagnostic
        ? log.appendUnless(failure, outcomes, live).catch(() => false)
        : false;
    });
  if (failed && claimed && diagnostic)
    logRunnerDiagnostic(
      { turnId: claims.turnId, sessionId: claims.sessionId },
      diagnostic,
    );
  await settleAndStop(log, claims.reconciliationLeaseToken);
}
