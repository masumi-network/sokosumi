import { beforeEach, expect, it, vi } from "vitest";

const { readNames, captureException } = vi.hoisted(() => ({
  readNames: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/helpers/chat-mention-names", () => ({
  loadChatMentionNames: readNames,
}));
vi.mock("@sentry/node", () => ({ captureException }));

import { previewOf } from "./chat-notification-preview";

beforeEach(() => vi.clearAllMocks());

it("shows a resolved human name instead of an opaque mention id", async () => {
  readNames.mockResolvedValue(
    new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Alice"]]),
  );
  expect(
    await previewOf({
      roomId: "room",
      messageId: "message",
      content: "ping @019fc7e4-e4bd-7005-900c-66e44d33f5e4 please",
    }),
  ).toBe("ping @Alice please");
});

it("omits the preview when a mention lookup fails, preserving the notification path", async () => {
  const failure = new Error("lookup failed");
  readNames.mockRejectedValue(failure);
  expect(
    await previewOf({
      roomId: "room",
      messageId: "message",
      content: "ping @019fc7e4-e4bd-7005-900c-66e44d33f5e4 please",
    }),
  ).toBe("");
  expect(captureException).toHaveBeenCalledWith(
    failure,
    expect.objectContaining({
      extra: {
        roomId: "room",
        messageId: "message",
        notificationType: "chat-mention-name",
      },
    }),
  );
});
