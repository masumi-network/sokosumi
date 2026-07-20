import type {
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
  SharedV4Warning,
} from "@ai-sdk/provider";

import {
  isReactJsonFencePrefixCandidate,
  parseReactEnvelopeBuffer,
} from "@sokosumi/utils";

import { extractTextFromCompletedOutput } from "../completed-output-text.js";

const SSE_DATA_PREFIX = "data: ";
const SSE_DONE_MARKER = "[DONE]";
const TEXT_BLOCK_ID = "sokosumi-output-text";
const REACT_THOUGHT_ID = "react-thought";
const MAX_REACT_ENVELOPE_BUFFER_CHARS = 16_384;
const DATA_IMAGE_URL_REGEX =
  /^data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i;

export function emptyUsage(): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

export function finishStop(): LanguageModelV4FinishReason {
  return { unified: "stop", raw: undefined };
}

export interface ResponsesSseToV4Options {
  warnings: SharedV4Warning[];
  onResponseStarted?: (responseId: string) => void | Promise<void>;
  onResponseCompleted?: (responseId: string) => void | Promise<void>;
  stripReactImageGenerationEnvelope?: boolean;
}

type SseChunk = {
  type?: string;
  delta?: string;
  text?: string;
  id?: string;
  item_id?: string;
  status?: string;
  item?: { type?: string; id?: string } & Record<string, unknown>;
  response?: { id?: string } & Record<string, unknown>;
  output?: unknown;
};

type ReactEnvelopeState = "idle" | "inEnvelope" | "afterEnvelope";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreviewableImageUrl(imageUrl: string): boolean {
  if (DATA_IMAGE_URL_REGEX.test(imageUrl)) {
    return true;
  }

  try {
    const protocol = new URL(imageUrl).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Walks objects/arrays for image tool payload shapes (`imageUrl`, nested
 * `image_url.url`). Does **not** JSON.parse string values: assistant text may
 * be valid JSON (e.g. `{"imageUrl":"…"}`) and must not become synthetic image
 * markdown.
 */
function collectImageUrlsFromObjectGraph(
  value: unknown,
  seen = new Set<unknown>(),
): string[] {
  if (typeof value === "string") {
    return [];
  }

  if (!value || typeof value !== "object" || seen.has(value)) {
    return [];
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectImageUrlsFromObjectGraph(item, seen));
  }

  const record = value as Record<string, unknown>;
  const urls: string[] = [];
  if (typeof record.imageUrl === "string" && record.imageUrl.trim()) {
    urls.push(record.imageUrl.trim());
  }

  if (isRecord(record.image_url)) {
    const nestedUrl = record.image_url.url;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) {
      urls.push(nestedUrl.trim());
    }
  }

  for (const nested of Object.values(record)) {
    urls.push(...collectImageUrlsFromObjectGraph(nested, seen));
  }

  return urls;
}

function tryParseJsonObjectOrArrayString(raw: string): unknown | undefined {
  const t = raw.trim();
  if (
    !(t.startsWith("{") && t.endsWith("}")) &&
    !(t.startsWith("[") && t.endsWith("]"))
  ) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** `function_call_output.output` may be a JSON string; parse at most once here. */
function collectImageUrlsFromFunctionCallOutput(
  output: unknown,
  seen = new Set<unknown>(),
): string[] {
  let root: unknown = output;
  if (typeof output === "string" && output.trim()) {
    const parsed = tryParseJsonObjectOrArrayString(output);
    root = parsed !== undefined ? parsed : output;
  }
  if (typeof root === "string") {
    return [];
  }
  return collectImageUrlsFromObjectGraph(root, seen);
}

function extractReasoningTextFromItem(item: unknown): string {
  if (!isRecord(item)) {
    return "";
  }

  if (!Array.isArray(item.summary)) {
    return "";
  }

  return item.summary
    .map((part) => {
      if (!isRecord(part) || part.type !== "summary_text") {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .filter((text) => text.trim().length > 0)
    .join("");
}

export function createResponsesSseToV4Stream(
  body: ReadableStream<Uint8Array>,
  options: ResponsesSseToV4Options,
): ReadableStream<LanguageModelV4StreamPart> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const {
    warnings,
    onResponseStarted,
    onResponseCompleted,
    stripReactImageGenerationEnvelope = false,
  } = options;

  return new ReadableStream<LanguageModelV4StreamPart>({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings });

      let buffer = "";
      let pendingLines: string[] = [];
      let lastEventLine: string | null = null;
      let textStarted = false;
      let streamClosed = false;
      let responseStartedCalled = false;
      let lastKnownResponseId: string | null = null;
      let onResponseCompletedEmitted = false;
      const reasoningAccumulator: Record<string, string> = {};
      const reasoningStarted = new Set<string>();
      const emittedImageKeys = new Set<string>();
      const emittedImageUrlsFromItems = new Set<string>();
      let needNewlineBeforeNextDelta = false;
      let reactEnvelopeState: ReactEnvelopeState = "idle";
      let pendingReactEnvelopeText = "";

      function closeWithFinish() {
        if (streamClosed) {
          return;
        }
        flushPendingReactEnvelopeText();
        streamClosed = true;
        if (textStarted) {
          controller.enqueue({ type: "text-end", id: TEXT_BLOCK_ID });
        }
        for (const id of reasoningStarted) {
          controller.enqueue({ type: "reasoning-end", id });
        }
        reasoningStarted.clear();
        controller.enqueue({
          type: "finish",
          usage: emptyUsage(),
          finishReason: finishStop(),
        });
        controller.close();
      }

      function ensureTextStart() {
        if (textStarted || streamClosed) {
          return;
        }
        controller.enqueue({ type: "text-start", id: TEXT_BLOCK_ID });
        textStarted = true;
      }

      function emitTextDelta(delta: string) {
        if (streamClosed || !delta) {
          return;
        }
        ensureTextStart();
        controller.enqueue({
          type: "text-delta",
          id: TEXT_BLOCK_ID,
          delta,
        });
      }

      function flushPendingReactEnvelopeText() {
        if (!pendingReactEnvelopeText) {
          return;
        }
        const text = pendingReactEnvelopeText;
        pendingReactEnvelopeText = "";
        reactEnvelopeState = "afterEnvelope";
        emitTextDelta(text);
      }

      function startsLikeReactEnvelopeCandidate(buffer: string): boolean {
        const trimmed = buffer.trimStart();
        if (trimmed.startsWith("{")) {
          return true;
        }
        if (trimmed === "") {
          return true;
        }
        const lower = trimmed.toLowerCase();
        return isReactJsonFencePrefixCandidate(lower);
      }

      function routeTextDelta(delta: string) {
        if (!delta) {
          return;
        }

        if (!stripReactImageGenerationEnvelope) {
          emitTextDelta(delta);
          return;
        }

        if (reactEnvelopeState === "afterEnvelope") {
          emitTextDelta(delta);
          return;
        }

        const nextBuffer = pendingReactEnvelopeText + delta;
        const startsLikeEnvelope = startsLikeReactEnvelopeCandidate(nextBuffer);

        if (reactEnvelopeState === "idle" && !startsLikeEnvelope) {
          emitTextDelta(delta);
          // Align with {@link extractReactEnvelope}: only a *leading* envelope is
          // stripped on persist. After non-candidate text was emitted, later `{`
          // chunks must pass through so streaming matches post-reload content.
          reactEnvelopeState = "afterEnvelope";
          return;
        }

        reactEnvelopeState = "inEnvelope";
        pendingReactEnvelopeText = nextBuffer;

        const parsed = parseReactEnvelopeBuffer(pendingReactEnvelopeText);
        if (parsed.status === "incomplete") {
          if (
            pendingReactEnvelopeText.length > MAX_REACT_ENVELOPE_BUFFER_CHARS
          ) {
            flushPendingReactEnvelopeText();
          }
          return;
        }

        pendingReactEnvelopeText = "";
        reactEnvelopeState = "afterEnvelope";

        if (!parsed.isReactEnvelope) {
          emitTextDelta(parsed.trailing);
          return;
        }

        if (parsed.thought) {
          emitReasoningDelta(REACT_THOUGHT_ID, parsed.thought);
        }
        emitTextDelta(parsed.trailing);
      }

      function emitCollectedImageUrls(
        imageUrls: string[],
        scopeKey: string,
        source: "item" | "aggregate",
      ) {
        for (const imageUrl of imageUrls) {
          if (!isPreviewableImageUrl(imageUrl)) {
            continue;
          }
          if (
            source === "aggregate" &&
            emittedImageUrlsFromItems.has(imageUrl)
          ) {
            continue;
          }
          const key = `${scopeKey}:${imageUrl}`;
          if (emittedImageKeys.has(key)) {
            continue;
          }
          emittedImageKeys.add(key);
          if (source === "item") {
            emittedImageUrlsFromItems.add(imageUrl);
          }
          // Transient live preview only. Core persists these image URLs as
          // structured file parts and strips the markdown from contentText.
          emitTextDelta(`\n\n![Generated image](${imageUrl})\n\n`);
        }
      }

      function ensureReasoningStart(id: string) {
        if (streamClosed || reasoningStarted.has(id)) {
          return;
        }
        reasoningStarted.add(id);
        controller.enqueue({ type: "reasoning-start", id });
      }

      function emitReasoningDelta(id: string, fullText: string) {
        if (streamClosed) {
          return;
        }
        ensureReasoningStart(id);
        const prev = reasoningAccumulator[id] ?? "";
        if (fullText.length <= prev.length) {
          return;
        }
        const delta = fullText.slice(prev.length);
        reasoningAccumulator[id] = fullText;
        controller.enqueue({
          type: "reasoning-delta",
          id,
          delta,
        });
      }

      async function processDataLine(data: string): Promise<boolean> {
        if (data === SSE_DONE_MARKER) {
          closeWithFinish();
          return true;
        }

        let chunk: SseChunk;
        try {
          chunk = JSON.parse(data) as SseChunk;
        } catch {
          return false;
        }

        const responseId =
          (typeof chunk.response?.id === "string"
            ? chunk.response.id
            : undefined) ??
          (typeof chunk.id === "string" ? chunk.id : undefined);

        const isResponseCreated =
          lastEventLine === "response.created" ||
          chunk.type === "response.created";

        if (
          typeof responseId === "string" &&
          !responseStartedCalled &&
          isResponseCreated
        ) {
          responseStartedCalled = true;
          lastKnownResponseId = responseId;
          await Promise.resolve(onResponseStarted?.(responseId));
          controller.enqueue({ type: "response-metadata", id: responseId });
        }

        if (chunk.type === "response.output_item.added") {
          const itemType = chunk.item?.type;
          if (itemType === "reasoning") {
            const id =
              typeof chunk.item?.id === "string" ? chunk.item.id : "reasoning";
            reasoningAccumulator[id] = "";
            ensureReasoningStart(id);
          }
        } else if (chunk.type === "response.reasoning_summary_text.delta") {
          const itemId =
            typeof chunk.item_id === "string" ? chunk.item_id : undefined;
          const delta =
            typeof chunk.delta === "string" ? chunk.delta : undefined;
          if (itemId && delta) {
            const next = (reasoningAccumulator[itemId] ?? "") + delta;
            emitReasoningDelta(itemId, next);
          }
        } else if (chunk.type === "response.reasoning_summary_text.done") {
          const itemId =
            typeof chunk.item_id === "string" ? chunk.item_id : undefined;
          const text = typeof chunk.text === "string" ? chunk.text : undefined;
          if (itemId && text) {
            emitReasoningDelta(itemId, text);
          }
        } else if (chunk.type === "response.output_item.done") {
          const itemId =
            typeof chunk.item?.id === "string" ? chunk.item.id : undefined;
          const item = chunk.item;
          if (item?.type === "function_call_output") {
            const output =
              item && "output" in item
                ? (item as Record<string, unknown>).output
                : undefined;
            emitCollectedImageUrls(
              collectImageUrlsFromFunctionCallOutput(output),
              itemId ?? "item",
              "item",
            );
          }
          if (itemId && chunk.item?.type === "reasoning") {
            const itemReasoningText = extractReasoningTextFromItem(chunk.item);
            if (itemReasoningText) {
              emitReasoningDelta(itemId, itemReasoningText);
            }
            delete reasoningAccumulator[itemId];
            if (reasoningStarted.has(itemId)) {
              controller.enqueue({ type: "reasoning-end", id: itemId });
              reasoningStarted.delete(itemId);
            }
          }
        }

        if (
          chunk.type === "response.output_item.done" &&
          chunk.item?.type === "message" &&
          textStarted
        ) {
          needNewlineBeforeNextDelta = true;
        }

        const deltaValue =
          typeof chunk.delta === "string"
            ? chunk.delta
            : typeof chunk.text === "string"
              ? chunk.text
              : undefined;

        const isDeltaEvent =
          chunk.type === "response.output_text.delta" ||
          chunk.type === "output_text.delta" ||
          lastEventLine === "response.output_text.delta";

        if (isDeltaEvent && deltaValue) {
          let toSend = deltaValue;
          if (needNewlineBeforeNextDelta) {
            needNewlineBeforeNextDelta = false;
            toSend = `\n\n${toSend}`;
          }
          routeTextDelta(toSend);
          return false;
        }

        const aggregateScope = responseId ?? lastKnownResponseId ?? "response";
        emitCollectedImageUrls(
          collectImageUrlsFromObjectGraph(chunk.output),
          aggregateScope,
          "aggregate",
        );
        emitCollectedImageUrls(
          collectImageUrlsFromObjectGraph(chunk.response),
          aggregateScope,
          "aggregate",
        );

        const isCompletionSignal =
          chunk.type === "response.completed" ||
          chunk.status === "completed" ||
          lastEventLine === "response.completed";
        const completionId =
          typeof responseId === "string" ? responseId : lastKnownResponseId;
        const isCompleted =
          isCompletionSignal &&
          typeof completionId === "string" &&
          !onResponseCompletedEmitted;

        if (isCompleted) {
          onResponseCompletedEmitted = true;
          await Promise.resolve(onResponseCompleted?.(completionId));
          closeWithFinish();
          return true;
        }

        return false;
      }

      try {
        while (!streamClosed) {
          if (pendingLines.length === 0) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lineArray = buffer.split("\n");
            buffer = lineArray.pop() ?? "";
            pendingLines.push(...lineArray);
            continue;
          }

          const line = pendingLines.shift()!;
          if (!line.trim() || line.startsWith(":")) {
            lastEventLine = null;
            continue;
          }
          if (line.startsWith("event:")) {
            lastEventLine = line.slice(6).trim();
            continue;
          }
          if (line.startsWith(SSE_DATA_PREFIX)) {
            const data = line.slice(SSE_DATA_PREFIX.length);
            const stop = await processDataLine(data);
            lastEventLine = null;
            if (stop) {
              return;
            }
            continue;
          }
          lastEventLine = null;
        }

        if (!streamClosed && buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer) as {
              status?: string;
              id?: string;
              output?: unknown;
            };
            if (parsed.status === "completed" && parsed.output !== undefined) {
              const text = extractTextFromCompletedOutput(parsed.output);
              if (text) {
                routeTextDelta(text);
              }
              const aggregateScope = parsed.id ?? lastKnownResponseId ?? "tail";
              emitCollectedImageUrls(
                collectImageUrlsFromObjectGraph(parsed.output),
                aggregateScope,
                "aggregate",
              );
              const tailCompletionId =
                typeof parsed.id === "string" ? parsed.id : lastKnownResponseId;
              if (
                typeof tailCompletionId === "string" &&
                !onResponseCompletedEmitted
              ) {
                onResponseCompletedEmitted = true;
                await Promise.resolve(onResponseCompleted?.(tailCompletionId));
              }
            }
          } catch {}
        }

        if (!streamClosed) {
          closeWithFinish();
        }
      } catch (error) {
        if (!streamClosed) {
          streamClosed = true;
          controller.enqueue({ type: "error", error });
          controller.close();
        }
        throw error;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
