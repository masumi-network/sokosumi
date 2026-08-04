import { describe, expect, it } from "vitest";
import { shouldSignalUnreadThreadsAttention } from "@/app/chat/utils/should-signal-unread-threads-attention";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

const CURRENT_USER_ID = "user_self";

function message(
  overrides: Partial<Pick<ChatRoomMessage, "parentMessageId" | "sender">> = {},
): Pick<ChatRoomMessage, "parentMessageId" | "sender"> {
  return {
    parentMessageId: "parent-1",
    sender: {
      type: "user",
      user: {
        id: "user_other",
        name: "Other",
        email: "other@example.com",
        image: null,
        presence: "offline",
      },
    },
    ...overrides,
  };
}

describe("shouldSignalUnreadThreadsAttention", () => {
  it("returns false for top-level messages", () => {
    expect(
      shouldSignalUnreadThreadsAttention(
        message({ parentMessageId: null }),
        CURRENT_USER_ID,
      ),
    ).toBe(false);
  });

  it("returns false for the current user's own replies", () => {
    expect(
      shouldSignalUnreadThreadsAttention(
        message({
          sender: {
            type: "user",
            user: {
              id: CURRENT_USER_ID,
              name: "Self",
              email: "self@example.com",
              image: null,
              presence: "online",
            },
          },
        }),
        CURRENT_USER_ID,
      ),
    ).toBe(false);
  });

  it("returns true for another user's thread reply", () => {
    expect(shouldSignalUnreadThreadsAttention(message(), CURRENT_USER_ID)).toBe(
      true,
    );
  });

  it("returns true for a coworker thread reply", () => {
    expect(
      shouldSignalUnreadThreadsAttention(
        message({
          sender: {
            type: "coworker",
            coworker: {
              id: "coworker_1",
              name: "Bot",
              slug: "bot",
              caption: null,
              image: null,
              presence: "online",
            },
          },
        }),
        CURRENT_USER_ID,
      ),
    ).toBe(true);
  });

  it("returns false for unknown senders", () => {
    expect(
      shouldSignalUnreadThreadsAttention(
        message({ sender: { type: "unknown" } }),
        CURRENT_USER_ID,
      ),
    ).toBe(false);
  });
});
