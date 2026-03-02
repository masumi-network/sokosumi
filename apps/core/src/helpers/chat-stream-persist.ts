import prisma from "@/lib/db/prisma";

const SSE_DATA_PREFIX = "data: ";
const UI_MESSAGE_EVENT_TEXT_DELTA = "text-delta";

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
