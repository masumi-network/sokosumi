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
  for await (const part of result.stream) parts.push(part);
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
