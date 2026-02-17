import {
  getEnv,
  getResponsesApiBaseUrl,
  isResponsesApiConfigured,
} from "@/config/env";

export const RESPONSES_API_AGENT_IDS = ["hannah", "elena"] as const;

export type ResponsesApiAgentId = (typeof RESPONSES_API_AGENT_IDS)[number];

export function isResponsesApiAgentId(
  coworkerId: string | undefined,
): coworkerId is ResponsesApiAgentId {
  return (
    typeof coworkerId === "string" &&
    RESPONSES_API_AGENT_IDS.includes(coworkerId as ResponsesApiAgentId)
  );
}

const SSE_DATA_PREFIX = "data: ";
const SSE_DONE_MARKER = "[DONE]";

function extractTextFromCompletedOutput(output: unknown): string {
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

export interface StreamResponsesApiOptions {
  sokosumiUserId: string;
  agentId?: ResponsesApiAgentId;
  previousResponseId?: string | null;
  instructions?: string;
  onResponseCompleted?: (responseId: string) => void;
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "X-Sokosumi-User-Id": options.sokosumiUserId,
      ...(options.agentId
        ? { "X-Agent-Id": options.agentId }
        : { "X-Agent-Id": "hannah" }),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Responses API error: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Responses API returned no body");
  }

  const stream = createResponsesApiUiStream(
    response.body,
    options.onResponseCompleted,
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}

function createResponsesApiUiStream(
  body: ReadableStream<Uint8Array>,
  onResponseCompleted?: (responseId: string) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const messageId = "response-message";

  let buffer = "";
  let textStarted = false;
  let streamClosed = false;
  let cancelled = false;
  let lastEventLine: string | null = null;

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
        status?: string;
      };

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
        handleTextDelta(deltaValue, controller);
        return false;
      }

      if (
        (chunk.type === "response.completed" || chunk.status === "completed") &&
        chunk.id
      ) {
        onResponseCompleted?.(chunk.id);
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

      try {
        while (!streamClosed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
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
                textStarted = true;
              }
              if (text) {
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
