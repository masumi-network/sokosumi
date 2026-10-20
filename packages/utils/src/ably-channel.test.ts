import { describe, expect, it } from "vitest";

import {
  CALENDAR_ACCESS_REVOKED_EVENT_NAME,
  CALENDAR_INVALIDATED_EVENT_NAME,
  makeAgentJobsCapabilityResourceName,
  makeAgentJobsChannelName,
  makeChatRoomChannelName,
  makeChatTypingChannelName,
  makeOrgPresenceChannelName,
  makeUserCalendarControlChannelName,
  makeUserChatControlChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
  makeWorkspaceCalendarChannelName,
  parseChatRoomIdFromChannelName,
  parseOrganizationIdFromPresenceChannelName,
  type RealtimeChannelEnvironment,
} from "./ably-channel";

const PRODUCTION: RealtimeChannelEnvironment = {
  network: "Mainnet",
  vercelEnv: "production",
  vercelGitCommitRef: "main",
};
const PREVIEW: RealtimeChannelEnvironment = {
  network: "Mainnet",
  vercelEnv: "preview",
  vercelGitCommitRef: "fix/soko-bot-inbox-paging",
};
const DEVELOPMENT: RealtimeChannelEnvironment = {
  network: "Preprod",
  vercelEnv: "development",
};

const PREVIEW_SCOPE = "preview:mainnet:branch_fix%2Fsoko-bot-inbox-paging";

describe("production channel names", () => {
  it.each([
    [
      makeAgentJobsChannelName("a1", "u1", PRODUCTION),
      "agent_jobs:agent_a1:user_u1",
    ],
    [makeUserTasksChannelName("u1", PRODUCTION), "tasks:all:user_u1"],
    [
      makeUserNotificationsChannelName("u1", PRODUCTION),
      "notifications:all:user_u1",
    ],
    [makeUserChatControlChannelName("u1", PRODUCTION), "chat_control:user_u1"],
    [
      makeWorkspaceCalendarChannelName("w1", "u1", PRODUCTION),
      "calendar:workspace_w1:user_u1",
    ],
    [
      makeUserCalendarControlChannelName("u1", PRODUCTION),
      "calendar_control:user_u1",
    ],
    [makeChatRoomChannelName("r1", PRODUCTION), "chat_rooms:room_r1"],
    [makeChatTypingChannelName("r1", PRODUCTION), "chat_typing:room_r1"],
    [makeOrgPresenceChannelName("o1", PRODUCTION), "presence:org_o1"],
  ])("keeps the production name %s", (actual, expected) => {
    expect(actual).toBe(expected);
  });
});

describe("preview channel names", () => {
  it.each([
    [
      makeAgentJobsChannelName("a1", "u1", PREVIEW),
      `agent_jobs:${PREVIEW_SCOPE}:agent_a1:user_u1`,
    ],
    [
      makeUserTasksChannelName("u1", PREVIEW),
      `tasks:${PREVIEW_SCOPE}:all:user_u1`,
    ],
    [
      makeUserChatControlChannelName("u1", PREVIEW),
      `chat_control:${PREVIEW_SCOPE}:user_u1`,
    ],
    [
      makeWorkspaceCalendarChannelName("w1", "u1", PREVIEW),
      `calendar:${PREVIEW_SCOPE}:workspace_w1:user_u1`,
    ],
    [
      makeUserCalendarControlChannelName("u1", PREVIEW),
      `calendar_control:${PREVIEW_SCOPE}:user_u1`,
    ],
    [
      makeChatRoomChannelName("r1", PREVIEW),
      `chat_rooms:${PREVIEW_SCOPE}:room_r1`,
    ],
    [
      makeChatTypingChannelName("r1", PREVIEW),
      `chat_typing:${PREVIEW_SCOPE}:room_r1`,
    ],
    [
      makeOrgPresenceChannelName("o1", PREVIEW),
      `presence:${PREVIEW_SCOPE}:org_o1`,
    ],
  ])("scopes a preview after the first segment: %s", (actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("keeps the shipped preview notification name", () => {
    expect(makeUserNotificationsChannelName("u1", PREVIEW)).toBe(
      `notifications:${PREVIEW_SCOPE}:user_u1`,
    );
  });

  it("throws for a preview without a ref", () => {
    const noRef: RealtimeChannelEnvironment = {
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "  ",
    };
    expect(() => makeChatRoomChannelName("r1", noRef)).toThrow(
      /Git branch ref/,
    );
    expect(() => makeUserNotificationsChannelName("u1", noRef)).toThrow(
      /Git branch ref/,
    );
  });

  it("encodes refs into one segment", () => {
    const roomName = (ref: string) =>
      makeChatRoomChannelName("r1", { ...PREVIEW, vercelGitCommitRef: ref });
    for (const ref of ["a/b", "a:b", "a b#%"]) {
      const branch = roomName(ref).split("branch_")[1]?.split(":room_")[0];
      expect(branch).toBeTruthy();
      expect(branch).not.toContain(":");
    }
    expect(roomName("a/b")).not.toBe(roomName("a%2Fb"));
  });
});

describe("agent jobs capability resource", () => {
  it("keeps the production wildcard", () => {
    expect(makeAgentJobsCapabilityResourceName("u1", PRODUCTION)).toBe(
      "agent_jobs:*:user_u1",
    );
  });

  it("scopes the wildcard outside production", () => {
    expect(makeAgentJobsCapabilityResourceName("u1", PREVIEW)).toBe(
      `agent_jobs:${PREVIEW_SCOPE}:*:user_u1`,
    );
  });
});

describe("development channel names", () => {
  it("scopes development", () => {
    expect(makeChatRoomChannelName("r1", DEVELOPMENT)).toBe(
      "chat_rooms:development:preprod:room_r1",
    );
    expect(makeUserNotificationsChannelName("u1", DEVELOPMENT)).toBe(
      "notifications:development:preprod:user_u1",
    );
  });

  it("treats a missing vercelEnv as development", () => {
    expect(makeChatRoomChannelName("r1", { network: "Mainnet" })).toBe(
      "chat_rooms:development:mainnet:room_r1",
    );
  });
});

describe("calendar event names", () => {
  it("exports canonical event names", () => {
    expect(CALENDAR_INVALIDATED_EVENT_NAME).toBe("calendar_invalidated");
    expect(CALENDAR_ACCESS_REVOKED_EVENT_NAME).toBe("calendar_access_revoked");
  });
});

describe.each([
  ["production", PRODUCTION],
  ["preview", PREVIEW],
  ["development", DEVELOPMENT],
])("parsers in %s", (_label, env) => {
  it("round-trips a room channel", () => {
    expect(
      parseChatRoomIdFromChannelName(makeChatRoomChannelName("r1", env), env),
    ).toBe("r1");
  });

  it("round-trips an org presence channel", () => {
    expect(
      parseOrganizationIdFromPresenceChannelName(
        makeOrgPresenceChannelName("o1", env),
        env,
      ),
    ).toBe("o1");
  });
});

describe("parsers across environments", () => {
  it("ignores a room channel from another environment", () => {
    expect(
      parseChatRoomIdFromChannelName(
        makeChatRoomChannelName("r1", PREVIEW),
        PRODUCTION,
      ),
    ).toBeNull();
    expect(
      parseChatRoomIdFromChannelName(
        makeChatRoomChannelName("r1", PRODUCTION),
        PREVIEW,
      ),
    ).toBeNull();
  });

  it("ignores an org presence channel from another environment", () => {
    expect(
      parseOrganizationIdFromPresenceChannelName(
        makeOrgPresenceChannelName("o1", PREVIEW),
        PRODUCTION,
      ),
    ).toBeNull();
  });

  it("returns null for non-room channels and empty ids", () => {
    expect(
      parseChatRoomIdFromChannelName(
        makeChatTypingChannelName("r1", PRODUCTION),
        PRODUCTION,
      ),
    ).toBeNull();
    expect(
      parseChatRoomIdFromChannelName("chat_rooms:room_", PRODUCTION),
    ).toBeNull();
    expect(
      parseChatRoomIdFromChannelName("chat_rooms:all:user_x", PRODUCTION),
    ).toBeNull();
    expect(
      parseChatRoomIdFromChannelName("notifications:all:user_abc", PRODUCTION),
    ).toBeNull();
    expect(
      parseOrganizationIdFromPresenceChannelName("presence:org_", PRODUCTION),
    ).toBeNull();
    expect(
      parseOrganizationIdFromPresenceChannelName(
        "chat_rooms:room_x",
        PRODUCTION,
      ),
    ).toBeNull();
  });
});
