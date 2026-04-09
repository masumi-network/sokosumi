import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

const SSE_DATA_PREFIX = "data: ";
const UI_MESSAGE_EVENT_TEXT_DELTA = "text-delta";

export interface ResponsesApiResponseIdRef {
  current: string | null;
}

export interface StreamWithAssistantPersistenceOptions {
  responsesApiResponseIdRef?: ResponsesApiResponseIdRef;
}

export function streamWithAssistantPersistence(
  upstreamStream: ReadableStream<Uint8Array>,
  conversationId: string,
  userId: string,
  options?: StreamWithAssistantPersistenceOptions,
): ReadableStream<Uint8Array> {
  const reader = upstreamStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let persisted = false;
  const responsesApiRef = options?.responsesApiResponseIdRef;

  function tryPersist(text: string): Promise<void> {
    if (persisted || !text.trim()) return Promise.resolve();
    persisted = true;
    return prisma.conversation
      .findFirst({
        where: {
          id: conversationId,
          userId,
          archivedAt: null,
        },
        select: { id: true, metadata: true },
      })
      .then(async (conv) => {
        if (!conv) return;

        let responsesApiResponseId: string | null = null;
        if (responsesApiRef) {
          responsesApiResponseId = responsesApiRef.current ?? null;
          if (!responsesApiResponseId && conv.metadata) {
            const meta = conv.metadata as Record<string, unknown>;
            const p = meta.pending_responses_api_response_id;
            if (typeof p === "string" && p.length > 0) {
              responsesApiResponseId = p;
            }
          }
        }

        if (responsesApiResponseId) {
          const existing = await prisma.conversationMessage.findFirst({
            where: {
              conversationId: conv.id,
              responsesApiResponseId,
            },
            select: { id: true },
          });
          if (existing) return;
          try {
            await prisma.conversationMessage.create({
              data: {
                conversationId: conv.id,
                role: "assistant",
                contentType: "output_text",
                contentText: text,
                responsesApiResponseId,
              },
            });
          } catch (error) {
            if (isPrismaUniqueViolation(error)) return;
            throw error;
          }
          return;
        }

        await prisma.conversationMessage.create({
          data: {
            conversationId: conv.id,
            role: "assistant",
            contentType: "output_text",
            contentText: text,
          },
        });
      })
      .then(() => undefined)
      .catch((error) => {
        console.error(
          "Failed to persist assistant message from stream:",
          error,
        );
      });
  }

  function safeClose(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    try {
      controller.close();
    } catch {}
  }

  function safeError(
    controller: ReadableStreamDefaultController<Uint8Array>,
    error: unknown,
  ): void {
    try {
      controller.error(error);
    } catch {}
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            await tryPersist(accumulatedText);
            safeClose(controller);
            return;
          }

          try {
            controller.enqueue(value);
          } catch {
            await tryPersist(accumulatedText);
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim() || line.startsWith(":")) continue;
            if (!line.startsWith(SSE_DATA_PREFIX)) continue;

            const data = line.slice(SSE_DATA_PREFIX.length);
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                delta?: string;
              };
              if (
                parsed.type === UI_MESSAGE_EVENT_TEXT_DELTA &&
                typeof parsed.delta === "string"
              ) {
                accumulatedText += parsed.delta;
              }
            } catch {}
          }
        }
      } catch (error) {
        await tryPersist(accumulatedText);
        safeError(controller, error);
      }
    },
    cancel(reason) {
      return tryPersist(accumulatedText).then(() => reader.cancel(reason));
    },
  });
}
