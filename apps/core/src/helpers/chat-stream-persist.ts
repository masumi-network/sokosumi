import prisma from "@/lib/db/prisma";

const SSE_DATA_PREFIX = "data: ";
const UI_MESSAGE_EVENT_TEXT_DELTA = "text-delta";

/**
 * Wraps a UI message stream (SSE), forwards all bytes unchanged, accumulates
 * assistant text from text-delta events, and persists one conversation item
 * when the stream ends (normal completion). Used so that if the client
 * disconnects, the backend still runs the stream to completion and saves
 * the full reply.
 */
export function streamWithAssistantPersistence(
  upstreamStream: ReadableStream<Uint8Array>,
  conversationId: string,
  userId: string,
): ReadableStream<Uint8Array> {
  const reader = upstreamStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let persisted = false;

  function tryPersist(text: string): void {
    if (persisted || !text.trim()) return;
    persisted = true;
    prisma.conversation
      .findFirst({
        where: {
          id: conversationId,
          userId,
          archivedAt: null,
        },
        select: { id: true },
      })
      .then((conv) => {
        if (!conv) return;
        return prisma.conversationItem.create({
          data: {
            conversationId: conv.id,
            role: "assistant",
            contentType: "output_text",
            contentText: text,
          },
        });
      })
      .catch((error) => {
        console.error(
          "Failed to persist assistant message from stream:",
          error,
        );
      });
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            tryPersist(accumulatedText);
            controller.close();
            return;
          }

          const chunk = value as Uint8Array;
          controller.enqueue(chunk);

          buffer += decoder.decode(chunk, { stream: true });
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
              // ignore non-JSON or other event types
            }
          }
        }
      } catch (error) {
        tryPersist(accumulatedText);
        controller.error(error);
      }
    },
    cancel(reason) {
      tryPersist(accumulatedText);
      return reader.cancel(reason);
    },
  });
}
