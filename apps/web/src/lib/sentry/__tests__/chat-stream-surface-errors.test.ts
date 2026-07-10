import { describe, expect, it } from "vitest";

import { createErrorEvent } from "@/lib/sentry/__tests__/error-event-fixture";
import { isExpectedChatStreamSurfaceError } from "@/lib/sentry/chat-stream-surface-errors";

describe("isExpectedChatStreamSurfaceError", () => {
  it("matches generic AI SDK chat stream errors on /chat", () => {
    expect(
      isExpectedChatStreamSurfaceError(
        createErrorEvent({
          transaction: "/chat",
          exception: {
            values: [
              {
                type: "Error",
                value: "An error occurred.",
                stacktrace: {
                  frames: [
                    {
                      filename:
                        "node_modules/.pnpm/ai@7.0.18_zod@4.4.3/node_modules/ai/dist/index.js",
                    },
                  ],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("matches generic stream errors on conversation chat routes", () => {
    expect(
      isExpectedChatStreamSurfaceError(
        createErrorEvent({
          transaction: "/chat/:bucketSlug/conversation/:conversationId",
          exception: {
            values: [{ type: "Error", value: "An error occurred." }],
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not match the same message outside chat routes", () => {
    expect(
      isExpectedChatStreamSurfaceError(
        createErrorEvent({
          transaction: "/tasks/:taskId",
          exception: {
            values: [{ type: "Error", value: "An error occurred." }],
          },
        }),
      ),
    ).toBe(false);
  });

  it("does not match actionable chat errors with specific messages", () => {
    expect(
      isExpectedChatStreamSurfaceError(
        createErrorEvent({
          transaction: "/chat",
          exception: {
            values: [
              {
                type: "Error",
                value: "Failed to load conversation",
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });
});
