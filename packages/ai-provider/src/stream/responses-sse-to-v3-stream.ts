import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { extractTextFromCompletedOutput } from "../completed-output-text.js";

const SSE_DATA_PREFIX = "data: ";
const SSE_DONE_MARKER = "[DONE]";
const TEXT_BLOCK_ID = "sokosumi-output-text";

export function emptyUsage(): LanguageModelV3Usage {
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

export function finishStop(): LanguageModelV3FinishReason {
  return { unified: "stop", raw: undefined };
}

export interface ResponsesSseToV3Options {
  warnings: SharedV3Warning[];
  onResponseStarted?: (responseId: string) => void;
  onResponseCompleted?: (responseId: string) => void;
}

type SseChunk = {
  type?: string;
  delta?: string;
  text?: string;
  id?: string;
  item_id?: string;
  status?: string;
  item?: { type?: string; id?: string };
  response?: { id?: string };
  output?: unknown;
};

export function createResponsesSseToV3Stream(
  body: ReadableStream<Uint8Array>,
  options: ResponsesSseToV3Options,
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const { warnings, onResponseStarted, onResponseCompleted } = options;

  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings });

      let buffer = "";
      let pendingLines: string[] = [];
      let lastEventLine: string | null = null;
      let textStarted = false;
      let streamClosed = false;
      let responseStartedCalled = false;
      const reasoningAccumulator: Record<string, string> = {};
      const reasoningStarted = new Set<string>();
      let needNewlineBeforeNextDelta = false;

      function closeWithFinish() {
        if (streamClosed) {
          return;
        }
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

      function processDataLine(data: string): boolean {
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
          onResponseStarted?.(responseId);
          controller.enqueue({ type: "response-metadata", id: responseId });
        }

        if (chunk.type === "response.output_item.added") {
          const itemType = chunk.item?.type;
          if (itemType === "reasoning") {
            const id =
              typeof chunk.item?.id === "string" ? chunk.item.id : "reasoning";
            reasoningAccumulator[id] = "";
            emitReasoningDelta(id, "Thinking...");
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
        } else if (chunk.type === "response.output_item.done") {
          const itemId =
            typeof chunk.item?.id === "string" ? chunk.item.id : undefined;
          if (itemId && chunk.item?.type === "reasoning") {
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
          emitTextDelta(toSend);
          return false;
        }

        const isCompleted =
          (chunk.type === "response.completed" ||
            chunk.status === "completed" ||
            lastEventLine === "response.completed") &&
          typeof responseId === "string";

        if (isCompleted) {
          onResponseCompleted?.(responseId);
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
            const stop = processDataLine(data);
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
                ensureTextStart();
                emitTextDelta(text);
              }
              if (typeof parsed.id === "string") {
                onResponseCompleted?.(parsed.id);
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
