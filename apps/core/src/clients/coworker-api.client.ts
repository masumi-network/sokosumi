import {
  getEnv,
  getResponsesApiBaseUrl,
  isResponsesApiConfigured,
} from "@/config/env";

const SSE_DATA_PREFIX = "data: ";
const SSE_DONE_MARKER = "[DONE]";

export function extractTextFromCompletedOutput(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) return "";
  const parts: string[] = [];
  for (const item of output) {
    const msg = item as { type?: string; content?: unknown[] };
    if (msg.type !== "message" || !Array.isArray(msg.content)) continue;
    for (const c of msg.content) {
      const part = c as { type?: string; text?: string };
      if (part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

const UI_MESSAGE_EVENTS = {
  START: "start",
  TEXT_START: "text-start",
  TEXT_DELTA: "text-delta",
  TEXT_END: "text-end",
  FINISH: "finish",
  ERROR: "error",
} as const;

const MAX_DELTA_CHUNK_SIZE = 80;
const CHUNK_STREAM_DELAY_MS = 16;

export interface StreamResponsesApiOptions {
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  coworkerSlug: string | null;
  previousResponseId?: string | null;
  instructions?: string;
  onResponseCompleted?: (responseId: string) => void;
  onResponseStarted?: (responseId: string) => void;
}

export async function streamResponsesApi(
  input: string | Array<{ role: string; content: string }>,
  options: StreamResponsesApiOptions,
): Promise<Response> {
  if (!isResponsesApiConfigured()) {
    throw new Error(
      "Responses API is not configured (missing key or base URL)",
    );
  }

  const baseUrl = getResponsesApiBaseUrl();
  const env = getEnv();
  const serviceKey = env.COWORKERS_API_SERVICE_KEY;

  if (!baseUrl || !serviceKey) {
    throw new Error("Responses API base URL or service key missing");
  }
  if (!options.coworkerSlug?.trim()) {
    throw new Error("Responses API requires a coworker agent ID (slug)");
  }

  const body: {
    input: string | Array<{ role: string; content: string }>;
    previous_response_id?: string;
    stream: boolean;
    instructions?: string;
  } = {
    input,
    stream: true,
  };

  if (options.previousResponseId) {
    body.previous_response_id = options.previousResponseId;
  }
  if (options.instructions) {
    body.instructions = options.instructions;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/responses`;
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    "X-Sokosumi-User-Id": options.sokosumiUserId,
    "X-Coworker-Slug": options.coworkerSlug,
  };
  if (options.sokosumiOrganizationId) {
    requestHeaders["X-Sokosumi-Organization-Id"] =
      options.sokosumiOrganizationId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Responses API error: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Responses API returned no body");
  }

  const stream = createResponsesApiUiStream(response.body, {
    onResponseCompleted: options.onResponseCompleted,
    onResponseStarted: options.onResponseStarted,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}

export type GetResponseResult =
  | { status: "completed"; id: string; output: unknown }
  | { status: "in_progress" | "not_found" };

export interface GetResponseByIdOptions {
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  coworkerSlug: string;
}

export async function getResponseById(
  responseId: string,
  options: GetResponseByIdOptions,
): Promise<GetResponseResult> {
  if (!isResponsesApiConfigured()) {
    throw new Error(
      "Responses API is not configured (missing key or base URL)",
    );
  }

  const baseUrl = getResponsesApiBaseUrl();
  const env = getEnv();
  const serviceKey = env.COWORKERS_API_SERVICE_KEY;

  if (!baseUrl || !serviceKey) {
    throw new Error("Responses API base URL or service key missing");
  }
  if (!options.coworkerSlug?.trim()) {
    throw new Error("Responses API requires a coworker slug");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/v1/responses/${encodeURIComponent(responseId)}`;
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    "X-Sokosumi-User-Id": options.sokosumiUserId,
    "X-Coworker-Slug": options.coworkerSlug,
  };
  if (options.sokosumiOrganizationId) {
    requestHeaders["X-Sokosumi-Organization-Id"] =
      options.sokosumiOrganizationId;
  }

  const response = await fetch(url, {
    method: "GET",
    headers: requestHeaders,
  });

  if (response.status === 404 || response.status === 202) {
    return {
      status: response.status === 404 ? "not_found" : "in_progress",
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Responses API GET error: ${response.status} ${errorText}`);
  }

  const body = (await response.json()) as {
    id?: string;
    status?: string;
    output?: unknown;
  };

  if (body.status === "completed" && body.output !== undefined) {
    return {
      status: "completed",
      id: typeof body.id === "string" ? body.id : responseId,
      output: body.output,
    };
  }

  return { status: "in_progress" };
}

interface CreateResponsesApiUiStreamOptions {
  onResponseCompleted?: (responseId: string) => void;
  onResponseStarted?: (responseId: string) => void;
}

function createResponsesApiUiStream(
  body: ReadableStream<Uint8Array>,
  options: CreateResponsesApiUiStreamOptions = {},
): ReadableStream<Uint8Array> {
  const { onResponseCompleted, onResponseStarted } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const messageId = "response-message";

  let buffer = "";
  let textStarted = false;
  let streamClosed = false;
  let cancelled = false;
  let lastEventLine: string | null = null;
  const responseStartedState = { called: false };
  const pendingDeltaChunks: string[] = [];
  const reasoningAccumulator: Record<string, string> = {};
  const needNewlineBeforeNextDelta = false;

  function closeStream(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) {
    if (streamClosed) return;
    streamClosed = true;

    if (textStarted) {
      const endEvent = { type: UI_MESSAGE_EVENTS.TEXT_END, id: messageId };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(endEvent)}\n\n`),
      );
    }

    const finishEvent = { type: UI_MESSAGE_EVENTS.FINISH };
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(finishEvent)}\n\n`),
    );
    controller.enqueue(encoder.encode(`data: ${SSE_DONE_MARKER}\n\n`));
    controller.close();
  }

  function emitDataReasoning(
    controller: ReadableStreamDefaultController<Uint8Array>,
    message: string,
    id: string,
  ) {
    if (streamClosed || textStarted) return;
    const event = {
      type: "data-reasoning",
      data: { message, id },
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  function handleTextDelta(
    delta: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) {
    if (streamClosed) return;

    if (!textStarted) {
      const startEvent = {
        type: UI_MESSAGE_EVENTS.TEXT_START,
        id: messageId,
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`),
      );
      textStarted = true;
    }

    const deltaEvent = {
      type: UI_MESSAGE_EVENTS.TEXT_DELTA,
      delta,
      id: messageId,
    };
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`),
    );
  }

  function processSSELine(
    data: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): boolean {
    if (data === SSE_DONE_MARKER) {
      closeStream(controller);
      return true;
    }

    try {
      const chunk = JSON.parse(data) as {
        type?: string;
        delta?: string;
        text?: string;
        id?: string;
        item_id?: string;
        status?: string;
        item?: { type?: string; id?: string };
        response?: { id?: string };
      };
      const responseId = (chunk.response?.id ?? chunk.id) as string | undefined;

      if (
        typeof responseId === "string" &&
        !responseStartedState.called &&
        lastEventLine === "response.created"
      ) {
        responseStartedState.called = true;
        onResponseStarted?.(responseId);
      }

      if (!textStarted) {
        if (lastEventLine === "response.created") {
          emitDataReasoning(controller, "Processing...", "reasoning-init");
        } else if (chunk.type === "response.output_item.added") {
          const itemType = chunk.item?.type;
          if (itemType === "reasoning") {
            const id =
              typeof chunk.item?.id === "string" ? chunk.item.id : "reasoning";
            reasoningAccumulator[id] = "";
            emitDataReasoning(controller, "Thinking...", id);
          }
        } else if (chunk.type === "response.reasoning_summary_text.delta") {
          const itemId =
            typeof chunk.item_id === "string" ? chunk.item_id : undefined;
          const delta =
            typeof chunk.delta === "string" ? chunk.delta : undefined;
          if (itemId && delta) {
            reasoningAccumulator[itemId] =
              (reasoningAccumulator[itemId] ?? "") + delta;
            emitDataReasoning(controller, reasoningAccumulator[itemId], itemId);
          }
        } else if (chunk.type === "response.output_item.done") {
          const itemId =
            typeof chunk.item?.id === "string" ? chunk.item.id : undefined;
          if (itemId && chunk.item?.type === "reasoning") {
            delete reasoningAccumulator[itemId];
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
          toSend = "\n\n" + toSend;
        }
        if (toSend.length <= MAX_DELTA_CHUNK_SIZE) {
          handleTextDelta(toSend, controller);
        } else {
          for (let i = 0; i < toSend.length; i += MAX_DELTA_CHUNK_SIZE) {
            pendingDeltaChunks.push(toSend.slice(i, i + MAX_DELTA_CHUNK_SIZE));
          }
        }
        return false;
      }

      const isCompleted =
        (chunk.type === "response.completed" ||
          chunk.status === "completed" ||
          lastEventLine === "response.completed") &&
        typeof responseId === "string";
      if (isCompleted) {
        onResponseCompleted?.(responseId);
        closeStream(controller);
        return true;
      }
    } catch (_) {}

    return false;
  }

  return new ReadableStream({
    async start(controller) {
      const startEvent = { type: UI_MESSAGE_EVENTS.START };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`),
      );

      const pendingLines: string[] = [];
      try {
        while (!streamClosed) {
          if (pendingDeltaChunks.length > 0) {
            const chunk = pendingDeltaChunks.shift()!;
            handleTextDelta(chunk, controller);
            await new Promise((r) => setTimeout(r, CHUNK_STREAM_DELAY_MS));
            continue;
          }
          if (pendingLines.length > 0) {
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
              const shouldStop = processSSELine(data, controller);
              lastEventLine = null;
              if (shouldStop) return;
            }
            continue;
          }
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lineArray = buffer.split("\n");
          buffer = lineArray.pop() ?? "";
          pendingLines.push(...lineArray);
        }

        while (!streamClosed && pendingDeltaChunks.length > 0) {
          const chunk = pendingDeltaChunks.shift()!;
          handleTextDelta(chunk, controller);
          await new Promise((r) => setTimeout(r, CHUNK_STREAM_DELAY_MS));
        }
        while (!streamClosed && pendingLines.length > 0) {
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
            const shouldStop = processSSELine(data, controller);
            lastEventLine = null;
            if (shouldStop) return;
          }
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
              if (!textStarted && text) {
                const startEvent = {
                  type: UI_MESSAGE_EVENTS.TEXT_START,
                  id: messageId,
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`),
                );
                const deltaEvent = {
                  type: UI_MESSAGE_EVENTS.TEXT_DELTA,
                  delta: text,
                  id: messageId,
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`),
                );
                const endEvent = {
                  type: UI_MESSAGE_EVENTS.TEXT_END,
                  id: messageId,
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(endEvent)}\n\n`),
                );
              }
              if (parsed.id) {
                onResponseCompleted?.(parsed.id);
              }
              streamClosed = true;
              if (textStarted) {
                const endEvent = {
                  type: UI_MESSAGE_EVENTS.TEXT_END,
                  id: messageId,
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(endEvent)}\n\n`),
                );
              }
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: UI_MESSAGE_EVENTS.FINISH,
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(`data: ${SSE_DONE_MARKER}\n\n`),
              );
              controller.close();
              return;
            }
          } catch (_) {}
        }

        if (!streamClosed) {
          closeStream(controller);
        }
      } catch (error) {
        if (cancelled) return;

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (!streamClosed) {
          streamClosed = true;
          const errorEvent = {
            type: UI_MESSAGE_EVENTS.ERROR,
            errorText: errorMessage,
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
          );
          controller.close();
        }

        throw error;
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
}
