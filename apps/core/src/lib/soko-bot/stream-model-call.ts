import { type LanguageModelMiddleware, streamText } from "ai";

/**
 * Soko Bot model calls stream, because the AI Gateway cuts a non-streamed
 * call off at about 60 seconds: a step that writes a long answer or one large
 * tool call failed every time. Both helpers keep the non-streamed behaviour
 * callers rely on; only the transport streams.
 */

type StreamTextOptions = Parameters<typeof streamText>[0];

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
  const [text, finishReason, steps, response] = await Promise.all([
    result.text,
    result.finishReason,
    result.steps,
    result.response,
  ]).catch((error: unknown) => {
    throw failure ?? error;
  });
  if (failure !== undefined) throw failure;
  return { text, finishReason, steps, response };
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
