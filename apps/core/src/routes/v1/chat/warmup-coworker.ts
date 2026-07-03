import {
  coworkerSseBodyExtractOutputText,
  coworkerSseBodyLooksLikeAgentError,
  MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
} from "@sokosumi/ai-provider";

import prisma from "@/lib/db/prisma";
import { getRedisClient } from "@/lib/redis";

export const MAX_WARMUP_ATTEMPTS = 5;
export const COWORKER_READY_REDIS_TTL_SECONDS = 120;
const WARMUP_ATTEMPT_TIMEOUT_MS = 25_000;
const WARMUP_RETRY_BACKOFF_MS = 500;

export type CoworkerWarmupState = "pending" | "ready" | "failed";

export type CoworkerWarmupReadState = CoworkerWarmupState | "unknown";

export type CoworkerWarmupStateSource = "redis" | "metadata" | "none";

export interface WarmupCoworkerConversationOptions {
  internalConversationId: string;
  userId: string;
  organizationId: string | null;
  coworkerSlug: string;
  responsesApiBaseUrl: string;
}

export interface CoworkerReadyStateReadResult {
  state: CoworkerWarmupReadState;
  completedAt: string | null;
  attempts: number | null;
  source: CoworkerWarmupStateSource;
}

const WARMUP_INPUT_MESSAGE = {
  type: "message" as const,
  role: "user" as const,
  content: [
    {
      type: "input_text" as const,
      text: "Internal connectivity check — reply with a short confirmation that you are ready.",
    },
  ],
};

export function coworkerReadyRedisKey(internalConversationId: string): string {
  return `coworker:ready:${internalConversationId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readRedisWarmupState(
  internalConversationId: string,
): Promise<CoworkerWarmupState | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const value = await redis.get(
      coworkerReadyRedisKey(internalConversationId),
    );
    if (value === "pending" || value === "ready" || value === "failed") {
      return value;
    }
    return null;
  } catch (error) {
    console.error("[warmup] Failed to read Redis ready state:", error);
    return null;
  }
}

async function writeRedisWarmupState(
  internalConversationId: string,
  state: CoworkerWarmupState,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.set(
      coworkerReadyRedisKey(internalConversationId),
      state,
      "EX",
      COWORKER_READY_REDIS_TTL_SECONDS,
    );
  } catch (error) {
    console.error("[warmup] Failed to write Redis ready state:", error);
  }
}

function readMetadataWarmupState(
  metadata: Record<string, unknown> | null | undefined,
): {
  state: CoworkerWarmupReadState;
  completedAt: string | null;
  attempts: number | null;
} {
  const warmupState = metadata?.warmup_state;
  if (
    warmupState === "pending" ||
    warmupState === "ready" ||
    warmupState === "failed"
  ) {
    const completedAt = metadata?.warmup_completed_at;
    const attempts = metadata?.warmup_attempts;
    return {
      state: warmupState,
      completedAt: typeof completedAt === "string" ? completedAt : null,
      attempts: typeof attempts === "number" ? attempts : null,
    };
  }

  return { state: "unknown", completedAt: null, attempts: null };
}

async function mergeConversationWarmupMetadata(
  internalConversationId: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT "metadata" FROM "conversation"
      WHERE "id" = ${internalConversationId} AND "userId" = ${userId}
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new Error("Conversation not found");
    }

    const currentMetadata =
      (rows[0]!.metadata as Record<string, unknown>) ?? {};

    await tx.conversation.update({
      where: { id: internalConversationId },
      data: {
        metadata: {
          ...currentMetadata,
          ...patch,
        },
      },
    });
  });
}

export async function setCoworkerReadyState(
  internalConversationId: string,
  userId: string,
  state: CoworkerWarmupState,
  completedAt: string | null = null,
  attempts: number | null = null,
): Promise<void> {
  await writeRedisWarmupState(internalConversationId, state);

  const metadataPatch: Record<string, unknown> = {
    warmup_state: state,
  };
  if (completedAt !== null) {
    metadataPatch.warmup_completed_at = completedAt;
  }
  if (attempts !== null) {
    metadataPatch.warmup_attempts = attempts;
  }

  await mergeConversationWarmupMetadata(
    internalConversationId,
    userId,
    metadataPatch,
  );
}

function isTerminalWarmupState(
  state: CoworkerWarmupReadState,
): state is Exclude<CoworkerWarmupState, "pending"> {
  return state === "ready" || state === "failed";
}

export async function readCoworkerReadyState(
  internalConversationId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<CoworkerReadyStateReadResult> {
  const metadataState = readMetadataWarmupState(metadata);
  const redisState = await readRedisWarmupState(internalConversationId);
  if (redisState) {
    if (
      redisState === "pending" &&
      isTerminalWarmupState(metadataState.state)
    ) {
      return {
        state: metadataState.state,
        completedAt: metadataState.completedAt,
        attempts: metadataState.attempts,
        source: "metadata",
      };
    }

    return {
      state: redisState,
      completedAt: redisState === "pending" ? null : metadataState.completedAt,
      attempts: metadataState.attempts,
      source: "redis",
    };
  }

  if (metadataState.state !== "unknown") {
    return {
      state: metadataState.state,
      completedAt: metadataState.completedAt,
      attempts: metadataState.attempts,
      source: "metadata",
    };
  }

  return {
    state: "unknown",
    completedAt: null,
    attempts: null,
    source: "none",
  };
}

async function consumeResponseBody(response: Response): Promise<string> {
  return response.text();
}

function warmupAttemptSucceeded(sseBody: string): boolean {
  if (coworkerSseBodyLooksLikeAgentError(sseBody)) {
    return false;
  }

  const text = coworkerSseBodyExtractOutputText(sseBody);
  return text.length >= MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS;
}

async function runWarmupAttempt(
  responsesApiBaseUrl: string,
  userId: string,
  organizationId: string | null,
  coworkerSlug: string,
): Promise<{ succeeded: boolean; retryable: boolean }> {
  const base = responsesApiBaseUrl.replace(/\/$/, "");
  const url = `${base}/responses`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sokosumi-User-Id": userId,
    "X-Coworker-Slug": coworkerSlug,
  };
  if (organizationId) {
    headers["X-Sokosumi-Organization-Id"] = organizationId;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: [WARMUP_INPUT_MESSAGE],
        stream: true,
      }),
      signal: AbortSignal.timeout(WARMUP_ATTEMPT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[warmup] Warmup request failed:", error);
    return { succeeded: false, retryable: true };
  }

  if (!response.ok) {
    console.error(`[warmup] Warmup request returned HTTP ${response.status}`);
    return {
      succeeded: false,
      retryable: response.status >= 500,
    };
  }

  let sseBody: string;
  try {
    sseBody = await consumeResponseBody(response);
  } catch (error) {
    console.error("[warmup] Warmup body read failed:", error);
    return { succeeded: false, retryable: true };
  }

  if (warmupAttemptSucceeded(sseBody)) {
    return { succeeded: true, retryable: false };
  }

  return { succeeded: false, retryable: true };
}

export async function warmupCoworkerConversation(
  options: WarmupCoworkerConversationOptions,
): Promise<void> {
  try {
    await setCoworkerReadyState(
      options.internalConversationId,
      options.userId,
      "pending",
      null,
      0,
    );

    for (let attempt = 1; attempt <= MAX_WARMUP_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await sleep((attempt - 1) * WARMUP_RETRY_BACKOFF_MS);
      }

      const result = await runWarmupAttempt(
        options.responsesApiBaseUrl,
        options.userId,
        options.organizationId,
        options.coworkerSlug,
      );

      if (result.succeeded) {
        await setCoworkerReadyState(
          options.internalConversationId,
          options.userId,
          "ready",
          new Date().toISOString(),
          attempt,
        );
        return;
      }

      if (!result.retryable || attempt === MAX_WARMUP_ATTEMPTS) {
        await setCoworkerReadyState(
          options.internalConversationId,
          options.userId,
          "failed",
          new Date().toISOString(),
          attempt,
        );
        break;
      }

      await setCoworkerReadyState(
        options.internalConversationId,
        options.userId,
        "pending",
        null,
        attempt,
      );
    }
  } catch (error) {
    console.error("[warmup] Unexpected error during coworker warmup:", error);
    try {
      await setCoworkerReadyState(
        options.internalConversationId,
        options.userId,
        "failed",
        new Date().toISOString(),
      );
    } catch (setError) {
      console.error(
        "[warmup] Failed to persist failed warmup state:",
        setError,
      );
    }
  }
}
