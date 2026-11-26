import { type LanguageModelMiddleware, RetryError, streamText } from "ai";
import {
  aiGatewayBudgetScope,
  GATEWAY_INTERNAL_SERVER_ERROR,
} from "../ai-gateway-budget-error";

/**
 * Soko Bot model calls stream, because the AI Gateway cuts a non-streamed
 * call off at about 60 seconds: a step that writes a long answer or one large
 * tool call failed every time. Both helpers keep the non-streamed behaviour
 * callers rely on; only the transport streams.
 */

type StreamTextOptions = Parameters<typeof streamText>[0];

// Gateway chat model IDs with thinking on by default.
const GOOGLE_MODELS_WITH_DEFAULT_THINKING = new Set([
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-3-flash",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.6-flash",
  "google/gemini-3.8-flash",
  "google/gemini-4-argon",
  "google/gemini-4-carbon",
  "google/gemini-4-hydrogen",
  "google/gemini-4-neon",
]);

/**
 * Each provider's switch for a returned reasoning summary (never raw
 * thoughts); other providers ignore it.
 */
export function modelReasoningSummaryOptions(
  model: StreamTextOptions["model"],
) {
  const modelId = typeof model === "string" ? model : model.modelId;
  return {
    openai: { reasoningSummary: "auto" },
    ...(GOOGLE_MODELS_WITH_DEFAULT_THINKING.has(modelId)
      ? { google: { thinkingConfig: { includeThoughts: true } } }
      : {}),
  };
}

/**
 * How long OpenAI keeps a cached prompt prefix, the longest it offers (all
 * of it ZDR-compatible): 24 hours before GPT-6; GPT-6 and later take a TTL
 * instead, at most 12 hours, and refuse the older option.
 */
export function promptCacheTtlOptions(model: string): Record<string, unknown> {
  return /^openai\/gpt-(?:[6-9]|5\.[6-9])/.test(model)
    ? { promptCacheOptions: { ttl: "12h" } }
    : { promptCacheRetention: "24h" };
}

/**
 * Provider options with OpenAI's prompt cache key and lifetime for a turn
 * whose system prompt and tools stay the same across turns; unchanged
 * without a key.
 */
export function withPromptCache<T extends Record<string, unknown>>(
  options: T,
  cacheKey: string | null | undefined,
  model: string,
): T {
  if (!cacheKey) return options;
  const openai = (options.openai ?? {}) as Record<string, unknown>;
  return {
    ...options,
    openai: {
      ...openai,
      promptCacheKey: cacheKey,
      ...promptCacheTtlOptions(model),
    },
  };
}

/**
 * A step's reasoning summary, one paragraph per part; undefined when the
 * provider returned none. `reasoningText` runs the parts together.
 */
export function stepReasoningSummary(step: {
  reasoning: readonly object[];
}): string | undefined {
  const summary = step.reasoning
    .map((part) =>
      "text" in part && typeof part.text === "string" ? part.text.trim() : "",
    )
    .filter(Boolean)
    .join("\n\n");
  return summary || undefined;
}

/** The runtime reports only a failure's name and message over the turn API. */
function unwrapGatewayBudgetRetry(error: unknown): unknown {
  if (!RetryError.isInstance(error)) return error;
  const last = error.lastError ?? error.errors.at(-1);
  return last instanceof Error &&
    last.name === GATEWAY_INTERNAL_SERVER_ERROR &&
    aiGatewayBudgetScope(last.message)
    ? last
    : error;
}

/**
 * `streamText`, settled like `generateText`: resolves once every step has
 * finished, or rejects with the first error the stream reported (which
 * `streamText` alone would only log).
 */
export async function streamModelCall(options: StreamTextOptions) {
  let failure: unknown;
  const result = streamText({
    ...options,
    onError: ({ error }) => {
      failure ??= error;
    },
  });
  const [text, finishReason, steps, responseMessages] = await Promise.all([
    result.text,
    result.finishReason,
    result.steps,
    result.responseMessages,
  ]).catch((error: unknown) => {
    throw unwrapGatewayBudgetRetry(failure ?? error);
  });
  if (failure !== undefined) throw unwrapGatewayBudgetRetry(failure);
  return { text, finishReason, steps, responseMessages };
}

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type ModelStreamResult = Awaited<
  ReturnType<Parameters<WrapStream>[0]["doStream"]>
>;
type ModelStreamPart =
  ModelStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
export type ModelStreamFinish = Extract<ModelStreamPart, { type: "finish" }>;

/**
 * How long a model stream may go without sending anything. The Gateway
 * sometimes leaves a streamed answer open and silent; a reader without this
 * waited until Vercel killed the invocation at 300 seconds. A healthy stream
 * sends a part every few seconds, even while the model writes one long tool
 * call.
 */
export const MODEL_STREAM_IDLE_MS = 90_000;

/** Longest one model call may take, inside Core's 300-second `maxDuration`. */
export const MODEL_CALL_MAX_MS = 240_000;

export class ModelStreamStalledError extends Error {
  constructor(idleMs: number) {
    super(`Model stream sent nothing for ${idleMs / 1000} seconds`);
    this.name = "ModelStreamStalledError";
  }
}

/**
 * Reads `stream` to its end, failing with `ModelStreamStalledError` once it
 * goes `idleMs` without a chunk. The source is cancelled either way, so a
 * stalled upstream connection is released.
 */
export async function* readUntilIdle<T>(
  stream: ReadableStream<T>,
  idleMs = MODEL_STREAM_IDLE_MS,
): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ModelStreamStalledError(idleMs)),
          idleMs,
        );
      });
      const next = await Promise.race([reader.read(), idle]).finally(() =>
        clearTimeout(timer),
      );
      if (next.done) return;
      yield next.value;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/**
 * Reads a model stream to its end before any part reaches the SDK, so
 * `inspect` sees the call's usage and routing metadata before a returned tool
 * call can run. The connection still streams; only the SDK waits.
 */
export async function holdModelStream(
  doStream: () => PromiseLike<ModelStreamResult>,
  inspect: (finish: ModelStreamFinish | undefined) => void | Promise<void>,
): Promise<ModelStreamResult> {
  const result = await doStream();
  const parts: ModelStreamPart[] = [];
  for await (const part of readUntilIdle(result.stream)) parts.push(part);
  await inspect(
    parts.findLast((part): part is ModelStreamFinish => part.type === "finish"),
  );
  return {
    ...result,
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}
