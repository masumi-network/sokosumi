import { describe, expect, it } from "vitest";

import type { ChatChannelMessage } from "@/lib/clients/generated/core";

import { mergeChannelMessages } from "../merge-channel-messages";

function message(
  id: string,
  createdAt: string,
  content = id,
): ChatChannelMessage {
  return {
    id,
    channelId: "channel-1",
    parentMessageId: null,
    content,
    createdAt: new Date(createdAt),
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
  };
}

describe("mergeChannelMessages", () => {
  it("keeps older loaded history when refreshing the latest page", () => {
    const older = message("m1", "2026-07-01T10:00:00.000Z");
    const mid = message("m2", "2026-07-01T11:00:00.000Z");
    const latest = message("m3", "2026-07-01T12:00:00.000Z");
    const refreshedLatest = message(
      "m3",
      "2026-07-01T12:00:00.000Z",
      "updated",
    );
    const newer = message("m4", "2026-07-01T13:00:00.000Z");

    const merged = mergeChannelMessages(
      [older, mid, latest],
      [refreshedLatest, newer],
    );

    expect(merged.map((row) => row.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(merged[2]?.content).toBe("updated");
  });

  it("prepends an older page without duplicating ids", () => {
    const older = message("m1", "2026-07-01T10:00:00.000Z");
    const mid = message("m2", "2026-07-01T11:00:00.000Z");
    const latest = message("m3", "2026-07-01T12:00:00.000Z");

    const merged = mergeChannelMessages([mid, latest], [older, mid]);

    expect(merged.map((row) => row.id)).toEqual(["m1", "m2", "m3"]);
  });
});
