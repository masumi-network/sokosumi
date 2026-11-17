import { AVATAR_DONE_MS } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import type {
  ChatBot,
  ChatTurn,
  SokoBotChatState,
} from "@/lib/soko-bot/chat-state";
import { avatarStateOfChat } from "./avatar-state";

const NOW = Date.parse("2026-11-17T12:00:00Z");

function chat(
  bot: Partial<ChatBot> = {},
  latest?: Partial<ChatTurn>,
): SokoBotChatState {
  return {
    bot: { status: "IDLE", pendingDecisions: [], ...bot } as ChatBot,
    turns: latest ? [latest as ChatTurn] : [],
  };
}

describe("avatarStateOfChat", () => {
  it("rests when nothing is going on", () => {
    expect(avatarStateOfChat(chat(), NOW)).toBe("idle");
  });

  it("works while a turn runs and thinks while it is queued", () => {
    expect(avatarStateOfChat(chat({}, { status: "RUNNING" }), NOW)).toBe(
      "working",
    );
    expect(avatarStateOfChat(chat({}, { status: "QUEUED" }), NOW)).toBe(
      "thinking",
    );
  });

  it("needs you for a pending decision, not a settled one", () => {
    const decision = (status: string) => ({ status }) as never;
    expect(
      avatarStateOfChat(chat({ pendingDecisions: [decision("PENDING")] }), NOW),
    ).toBe("needs_you");
    expect(
      avatarStateOfChat(
        chat({ pendingDecisions: [decision("ACCEPTED")] }),
        NOW,
      ),
    ).toBe("idle");
  });

  it("celebrates a turn that just completed, then rests", () => {
    const at = (ago: number) => new Date(NOW - ago).toISOString();
    expect(
      avatarStateOfChat(
        chat({}, { status: "COMPLETED", completedAt: at(1000) }),
        NOW,
      ),
    ).toBe("done");
    expect(
      avatarStateOfChat(
        chat({}, { status: "COMPLETED", completedAt: at(AVATAR_DONE_MS + 1) }),
        NOW,
      ),
    ).toBe("idle");
  });

  it("sleeps when paused and shows an error over everything", () => {
    expect(avatarStateOfChat(chat({ status: "PAUSED" }), NOW)).toBe("sleeping");
    expect(
      avatarStateOfChat(chat({ status: "ERROR" }, { status: "RUNNING" }), NOW),
    ).toBe("error");
  });
});
