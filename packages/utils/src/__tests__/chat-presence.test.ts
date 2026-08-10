import { describe, expect, it } from "vitest";

import {
  aggregateChatPresenceByUserId,
  buildAblyPresenceClientId,
  isValidAblyClientInstanceId,
  parseChatPresenceMemberData,
  parseUserIdFromAblyPresenceClientId,
  resolveUserChatPresence,
} from "../chat-presence.js";
import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "../chat-presence-windows.js";

describe("ably presence clientId", () => {
  it("builds and parses userId:instanceId", () => {
    const clientId = buildAblyPresenceClientId("user_abc", "inst_12345");
    expect(clientId).toBe("user_abc:inst_12345");
    expect(parseUserIdFromAblyPresenceClientId(clientId)).toBe("user_abc");
  });

  it("rejects bare userId and bad instance ids", () => {
    expect(parseUserIdFromAblyPresenceClientId("user_abc")).toBeNull();
    expect(parseUserIdFromAblyPresenceClientId("user_abc:short")).toBeNull();
    expect(isValidAblyClientInstanceId("inst_12345")).toBe(true);
    expect(isValidAblyClientInstanceId("bad id")).toBe(false);
  });
});

describe("parseChatPresenceMemberData", () => {
  it("accepts valid payloads", () => {
    expect(
      parseChatPresenceMemberData({
        lastActiveAt: 1_700_000_000_000,
        visible: true,
      }),
    ).toEqual({ lastActiveAt: 1_700_000_000_000, visible: true });
  });

  it("rejects invalid payloads", () => {
    expect(parseChatPresenceMemberData(null)).toBeNull();
    expect(parseChatPresenceMemberData({ lastActiveAt: 1 })).toBeNull();
    expect(
      parseChatPresenceMemberData({ lastActiveAt: "x", visible: true }),
    ).toBeNull();
  });
});

describe("aggregateChatPresenceByUserId", () => {
  const now = 1_000_000;
  const instanceA = "instanceA1";
  const instanceB = "instanceB2";

  it("marks offline when user has no members", () => {
    expect(resolveUserChatPresence([], "user_1", now)).toBe("offline");
  });

  it("marks online when any device is visible and recently active", () => {
    const map = aggregateChatPresenceByUserId(
      [
        {
          clientId: buildAblyPresenceClientId("user_1", instanceA),
          data: {
            lastActiveAt: now - 60_000,
            visible: true,
          },
        },
        {
          clientId: buildAblyPresenceClientId("user_1", instanceB),
          data: {
            lastActiveAt: now - CHAT_PRESENCE_ONLINE_WINDOW_MS - 1,
            visible: true,
          },
        },
      ],
      now,
    );
    expect(map.get("user_1")).toBe("online");
  });

  it("marks afk when connected but hidden or idle", () => {
    expect(
      resolveUserChatPresence(
        [
          {
            clientId: buildAblyPresenceClientId("user_1", instanceA),
            data: { lastActiveAt: now, visible: false },
          },
        ],
        "user_1",
        now,
      ),
    ).toBe("afk");

    expect(
      resolveUserChatPresence(
        [
          {
            clientId: buildAblyPresenceClientId("user_1", instanceA),
            data: {
              lastActiveAt: now - CHAT_PRESENCE_ONLINE_WINDOW_MS - 1,
              visible: true,
            },
          },
        ],
        "user_1",
        now,
      ),
    ).toBe("afk");
  });

  it("aggregates multi-user maps", () => {
    const map = aggregateChatPresenceByUserId(
      [
        {
          clientId: buildAblyPresenceClientId("alice", instanceA),
          data: { lastActiveAt: now, visible: true },
        },
        {
          clientId: buildAblyPresenceClientId("bob", instanceB),
          data: { lastActiveAt: now, visible: false },
        },
      ],
      now,
    );
    expect(map.get("alice")).toBe("online");
    expect(map.get("bob")).toBe("afk");
    expect(map.has("carol")).toBe(false);
  });
});
