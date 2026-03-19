import prisma from "@/lib/db/prisma";

const SSE_DATA_PREFIX = "data: ";
const UI_MESSAGE_EVENT_TEXT_DELTA = "text-delta";

/** Shared with `onResponseStarted` so persist sees the same Responses API id. */
export interface ResponsesApiResponseIdRef {
  current: string | null;
}

export interface StreamWithAssistantPersistenceOptions {
  /**
   * Coworker / Responses API streams: set synchronously in `onResponseStarted`.
   * Used to set `responsesApiResponseId` on the assistant row and to skip
   * persist when recovery (or a race) already inserted that row.
   */
  responsesApiResponseIdRef?: ResponsesApiResponseIdRef;
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
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
  const useResponsesApiId = Boolean(options?.responsesApiResponseIdRef);

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
        select: useResponsesApiId ? { id: true, metadata: true } : { id: true },
      })
      .then(async (conv) => {
        if (!conv) return;

        let responsesApiResponseId: string | null = null;
        if (useResponsesApiId) {
          responsesApiResponseId =
            options!.responsesApiResponseIdRef!.current ?? null;
          if (!responsesApiResponseId) {
            const pending = (conv as { metadata?: unknown }).metadata as
              | Record<string, unknown>
              | null
              | undefined;
            const p = pending?.pending_responses_api_response_id;
            if (typeof p === "string" && p.length > 0) {
              responsesApiResponseId = p;
            }
          }
        }

        if (responsesApiResponseId) {
          const existing = await prisma.conversationItem.findFirst({
            where: {
              conversationId: conv.id,
              responsesApiResponseId,
            },
            select: { id: true },
          });
          if (existing) return;
          try {
            await prisma.conversationItem.create({
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

        try {
          await prisma.conversationItem.create({
            data: {
              conversationId: conv.id,
              role: "assistant",
              contentType: "output_text",
              contentText: text,
            },
          });
        } catch (error) {
          if (isPrismaUniqueViolation(error)) return;
          throw error;
        }
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
    } catch {
      // Consumer already closed or cancelled the stream.
    }
  }

  function safeError(
    controller: ReadableStreamDefaultController<Uint8Array>,
    error: unknown,
  ): void {
    try {
      controller.error(error);
    } catch {
      // Consumer already closed or cancelled the stream.
    }
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
            // Consumer cancelled; persist what we have and exit without closing again.
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
            } catch {
              // skip non-JSON lines
            }
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
