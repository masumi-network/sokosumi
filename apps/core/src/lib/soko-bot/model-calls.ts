import { AsyncLocalStorage } from "node:async_hooks";
import { registerTelemetry, type Telemetry } from "ai";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { gatewayCostUsd } from "./gateway-cost";

/**
 * Every AI Gateway call made for a turn lands in `soko_bot_model_call`: what
 * was asked for, what the Gateway says answered, and what it cost there.
 * Calls inside a turn's work find the turn here; calls outside one (a cron's
 * own check, a media job) are not recorded.
 */
const turnStorage = new AsyncLocalStorage<{ turnId: string }>();

export type ModelCallRole =
  | "agent"
  | "classifier"
  | "judge"
  | "check"
  | "search"
  | "embedding";

export function withModelCallTurn<T>(turnId: string, run: () => T): T {
  registerModelCallTelemetry();
  return turnStorage.run({ turnId }, run);
}

export function modelCallTurnId(): string | undefined {
  return turnStorage.getStore()?.turnId;
}

const text = z.string().max(200).nullish().catch(null);
const flag = z.boolean().nullish().catch(null);
/** Lenient on purpose: one odd field must not hide the rest of the report. */
const routingSchema = z.object({
  gateway: z.object({
    routing: z
      .object({
        originalModelId: text,
        finalProvider: text,
        canonicalSlug: text,
        modelAttempts: z
          .array(
            z.object({
              canonicalSlug: text,
              success: flag,
              providerAttempts: z
                .array(
                  z.object({
                    provider: text,
                    success: flag,
                    inferenceEndpoint: z
                      .object({ geoRegion: text })
                      .nullish()
                      .catch(null),
                  }),
                )
                .max(32)
                .nullish()
                .catch(null),
            }),
          )
          .max(32)
          .nullish()
          .catch(null),
      })
      .nullish()
      .catch(null),
    enabledZeroDataRetention: flag,
    generationId: text,
  }),
});

/** What the Gateway says answered a call; nulls where it reported nothing. */
export function gatewayCallFacts(metadata: unknown): {
  requestedModel: string | null;
  answeredModel: string | null;
  provider: string | null;
  region: string | null;
  zeroDataRetention: boolean | null;
  generationId: string | null;
} {
  const parsed = routingSchema.safeParse(metadata);
  if (!parsed.success)
    return {
      requestedModel: null,
      answeredModel: null,
      provider: null,
      region: null,
      zeroDataRetention: null,
      generationId: null,
    };
  const { routing, enabledZeroDataRetention, generationId } =
    parsed.data.gateway;
  const attempts = routing?.modelAttempts ?? [];
  const answered =
    attempts.findLast((attempt) => attempt.success) ?? attempts.at(-1);
  const providerAttempt =
    answered?.providerAttempts?.findLast((attempt) => attempt.success) ??
    answered?.providerAttempts?.at(-1);
  return {
    requestedModel: routing?.originalModelId ?? null,
    answeredModel: answered?.canonicalSlug ?? routing?.canonicalSlug ?? null,
    provider: routing?.finalProvider ?? providerAttempt?.provider ?? null,
    region: providerAttempt?.inferenceEndpoint?.geoRegion ?? null,
    zeroDataRetention: enabledZeroDataRetention ?? null,
    generationId: generationId ?? null,
  };
}

export interface ModelCallRecord {
  /** Defaults to the turn whose work this call runs in. */
  turnId?: string;
  role: ModelCallRole;
  label?: string;
  requestedModel: string;
  providerMetadata?: unknown;
  usage?: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
  };
  /** Overrides the Gateway's reported cost, e.g. a priced search. */
  costUsd?: number;
  failed?: boolean;
}

function whole(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}

/** Never throws: a lost record must not fail the turn it describes. */
export async function recordModelCall(record: ModelCallRecord): Promise<void> {
  const turnId = record.turnId ?? modelCallTurnId();
  if (!turnId) return;
  const { requestedModel, ...facts } = gatewayCallFacts(
    record.providerMetadata,
  );
  const costUsd = record.costUsd ?? gatewayCostUsd(record.providerMetadata);
  try {
    await prisma.sokoBotModelCall.create({
      data: {
        turnId,
        role: record.role,
        label: record.label?.slice(0, 80) ?? null,
        // The SDK's telemetry drops the provider prefix ("gpt-6-luna").
        requestedModel: (record.requestedModel.includes("/")
          ? record.requestedModel
          : (requestedModel ?? record.requestedModel)
        ).slice(0, 200),
        ...facts,
        inputTokens: whole(record.usage?.inputTokens),
        cacheReadTokens: whole(record.usage?.cacheReadTokens),
        cacheWriteTokens: whole(record.usage?.cacheWriteTokens),
        outputTokens: whole(record.usage?.outputTokens),
        costUsdMicros: BigInt(Math.round(Math.max(0, costUsd) * 1_000_000)),
        failed: record.failed ?? false,
      },
    });
  } catch (error) {
    recordCoreWarning(
      { operation: "soko_bot_model_call" },
      {
        message: "A Soko Bot model call was not recorded",
        why: "Writing soko_bot_model_call failed",
        fix: "The turn itself is unaffected; check the database if it repeats.",
      },
      { turn: { id: turnId }, failure: messageSafeErrorFields(error) },
    );
  }
}

/** `telemetry.functionId` of the calls that are not checks, by role. */
const FUNCTION_ROLES = {
  "soko-bot-agent": "agent",
  "cmo-month-writer": "agent",
  "soko-bot-judge": "judge",
  "soko-bot-search": "search",
} as const satisfies Record<string, ModelCallRole>;

/** Tags a call for `telemetry`, so its record carries the right role. */
export function modelCallTelemetryFor(functionId: keyof typeof FUNCTION_ROLES) {
  return { functionId };
}

function roleOf(functionId: string | undefined): ModelCallRole {
  return functionId && Object.hasOwn(FUNCTION_ROLES, functionId)
    ? FUNCTION_ROLES[functionId as keyof typeof FUNCTION_ROLES]
    : "check";
}

/**
 * The AI SDK reports every language-model and Jev call here, whichever code
 * made it, so no call inside a turn goes unrecorded. Embeddings report no
 * cost, so `embeddings.ts` records its own.
 */
export const modelCallTelemetry: Telemetry = {
  onLanguageModelCallEnd(event) {
    const usage = event.usage;
    return recordModelCall({
      role: roleOf(event.functionId),
      label: event.functionId,
      requestedModel: event.modelId,
      providerMetadata: event.providerMetadata,
      usage: {
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
        outputTokens: usage.outputTokens,
      },
    });
  },
  experimental_onDecisionModelCallEnd(event) {
    return recordModelCall({
      role: "check",
      label: event.functionId ?? "jev",
      requestedModel: event.modelId,
      providerMetadata: event.providerMetadata,
      usage: {
        inputTokens: event.usage?.inputTokens,
        outputTokens: event.usage?.outputTokens,
      },
    });
  },
};

let registered = false;
function registerModelCallTelemetry(): void {
  if (registered) return;
  registered = true;
  registerTelemetry(modelCallTelemetry);
}
