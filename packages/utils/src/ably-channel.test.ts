import { describe, expect, it } from "vitest";

import {
  CALENDAR_ACCESS_REVOKED_EVENT_NAME,
  CALENDAR_INVALIDATED_EVENT_NAME,
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
  parseUserIdFromCalendarControlChannelName,
  parseWorkspaceCalendarChannelName,
} from "./ably-channel";

describe("makeUserNotificationsChannelName", () => {
  it("keeps the existing channel outside Vercel previews", () => {
    expect(
      makeUserNotificationsChannelName("user_123", {
        network: "Mainnet",
        vercelEnv: "production",
        vercelGitCommitRef: "main",
      }),
    ).toBe("notifications:all:user_user_123");
  });

  it("isolates a preview by network and exact branch ref", () => {
    expect(
      makeUserNotificationsChannelName("user_123", {
        network: "Mainnet",
        vercelEnv: "preview",
        vercelGitCommitRef: "fix/push%urls",
      }),
    ).toBe(
      "notifications:preview:mainnet:branch_fix%2Fpush%25urls:user_user_123",
    );
  });

  it("refuses an unscoped preview channel", () => {
    expect(() =>
      makeUserNotificationsChannelName("user_123", {
        network: "Mainnet",
        vercelEnv: "preview",
      }),
    ).toThrow("Preview notification channels require a Git branch ref");
  });
});

describe("makeUserTasksChannelName", () => {
  it("builds a user-scoped tasks channel", () => {
    expect(makeUserTasksChannelName("user_123")).toBe(
      "tasks:all:user_user_123",
    );
  });
});

describe("makeAgentJobsChannelName", () => {
  it("builds an agent-user scoped jobs channel", () => {
    expect(makeAgentJobsChannelName("agent_123", "user_123")).toBe(
      "agent_jobs:agent_agent_123:user_user_123",
    );
  });
});

describe("makeChatRoomChannelName", () => {
  it("builds a room-scoped chat channel", () => {
    expect(
      makeChatRoomChannelName("660e8400-e29b-41d4-a716-446655440000"),
    ).toBe("chat_rooms:room_660e8400-e29b-41d4-a716-446655440000");
  });
});

describe("makeUserChatControlChannelName", () => {
  it("builds a user-scoped chat control channel", () => {
    expect(makeUserChatControlChannelName("user_123")).toBe(
      "chat_control:user_user_123",
    );
  });
});

describe("calendar channel names", () => {
  it("round-trips a user-scoped workspace channel", () => {
    const channelName = makeWorkspaceCalendarChannelName(
      "workspace_123",
      "user_123",
    );

    expect(channelName).toBe("calendar:workspace_workspace_123:user_user_123");
    expect(parseWorkspaceCalendarChannelName(channelName)).toEqual({
      workspaceId: "workspace_123",
      userId: "user_123",
    });
  });

  it("rejects malformed workspace channels", () => {
    expect(
      parseWorkspaceCalendarChannelName("calendar:workspace_:user_user_123"),
    ).toBeNull();
    expect(
      parseWorkspaceCalendarChannelName(
        "calendar:workspace_workspace_123:user_",
      ),
    ).toBeNull();
    expect(
      parseWorkspaceCalendarChannelName(
        "calendar:workspace_workspace_123:user_user_123:extra",
      ),
    ).toBeNull();
  });

  it("round-trips the user calendar control channel", () => {
    const channelName = makeUserCalendarControlChannelName("user_123");

    expect(channelName).toBe("calendar_control:user_user_123");
    expect(parseUserIdFromCalendarControlChannelName(channelName)).toBe(
      "user_123",
    );
  });

  it("rejects malformed calendar control channels", () => {
    expect(
      parseUserIdFromCalendarControlChannelName("calendar_control:user_"),
    ).toBeNull();
    expect(
      parseUserIdFromCalendarControlChannelName(
        "calendar_control:user_user_123:extra",
      ),
    ).toBeNull();
  });

  it("exports canonical event names", () => {
    expect(CALENDAR_INVALIDATED_EVENT_NAME).toBe("calendar_invalidated");
    expect(CALENDAR_ACCESS_REVOKED_EVENT_NAME).toBe("calendar_access_revoked");
  });
});

describe("parseChatRoomIdFromChannelName", () => {
  it("round-trips makeChatRoomChannelName", () => {
    const roomId = "660e8400-e29b-41d4-a716-446655440000";
    expect(
      parseChatRoomIdFromChannelName(makeChatRoomChannelName(roomId)),
    ).toBe(roomId);
  });

  it("returns null for non-room channels and empty id", () => {
    expect(
      parseChatRoomIdFromChannelName("notifications:all:user_abc"),
    ).toBeNull();
    expect(parseChatRoomIdFromChannelName("chat_rooms:room_")).toBeNull();
    expect(parseChatRoomIdFromChannelName("chat_rooms:all:user_x")).toBeNull();
  });
});

describe("chat typing channel names", () => {
  it("names a room's typing channel apart from its message channel", () => {
    expect(makeChatTypingChannelName("room_1")).toBe("chat_typing:room_room_1");
    expect(makeChatTypingChannelName("room_1")).not.toBe(
      makeChatRoomChannelName("room_1"),
    );
  });

  it("is not mistaken for a room message channel", () => {
    expect(
      parseChatRoomIdFromChannelName(makeChatTypingChannelName("room_1")),
    ).toBeNull();
  });
});

describe("org presence channel names", () => {
  it("round-trips makeOrgPresenceChannelName", () => {
    expect(
      parseOrganizationIdFromPresenceChannelName(
        makeOrgPresenceChannelName("org_123"),
      ),
    ).toBe("org_123");
  });

  it("returns null for non-presence channels", () => {
    expect(
      parseOrganizationIdFromPresenceChannelName("chat_rooms:room_x"),
    ).toBeNull();
    expect(
      parseOrganizationIdFromPresenceChannelName("presence:org_"),
    ).toBeNull();
  });
});
