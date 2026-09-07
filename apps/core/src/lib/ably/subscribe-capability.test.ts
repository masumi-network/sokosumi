import { describe, expect, it } from "vitest";

import { buildAblyClientCapability } from "./subscribe-capability";

const NON_PREVIEW_ENVIRONMENT = {
  network: "Mainnet" as const,
  vercelEnv: "production" as const,
  vercelGitCommitRef: "main",
};

describe("buildAblyClientCapability", () => {
  it("grants user task/notification channels and per-room chat channels", () => {
    const capability = buildAblyClientCapability({
      userId: "user_123",
      roomIds: ["room-a", "room-b"],
      organizationIds: [],
      notificationChannelEnvironment: NON_PREVIEW_ENVIRONMENT,
    });

    expect(capability).toEqual({
      "agent_jobs:*:user_user_123": ["subscribe"],
      "tasks:all:user_user_123": ["subscribe"],
      "notifications:all:user_user_123": ["subscribe", "push-subscribe"],
      "chat_control:user_user_123": ["subscribe"],
      "chat_rooms:room_room-a": ["subscribe"],
      "chat_rooms:room_room-b": ["subscribe"],
    });
  });

  // buildAblyClientCapability, not the buildAblySubscribeCapability wrapper:
  // this is the function the token mint actually calls, so the grant is
  // asserted on the path a browser token really takes.
  it("grants push-subscribe on the notifications channel only", () => {
    const capability = buildAblyClientCapability({
      userId: "user_123",
      roomIds: ["room-a"],
      organizationIds: ["org_a"],
      notificationChannelEnvironment: NON_PREVIEW_ENVIRONMENT,
    });

    expect(capability["notifications:all:user_user_123"]).toEqual([
      "subscribe",
      "push-subscribe",
    ]);
    expect(
      Object.entries(capability)
        .filter(([, ops]) => ops.includes("push-subscribe"))
        .map(([channel]) => channel),
    ).toEqual(["notifications:all:user_user_123"]);
  });

  it("grants a preview access only to its branch notification channel", () => {
    const capability = buildAblyClientCapability({
      userId: "user_123",
      roomIds: [],
      organizationIds: [],
      notificationChannelEnvironment: {
        network: "Mainnet",
        vercelEnv: "preview",
        vercelGitCommitRef: "fix/push-urls",
      },
    });

    expect(capability["notifications:all:user_user_123"]).toBeUndefined();
    expect(
      capability[
        "notifications:preview:mainnet:branch_fix%2Fpush-urls:user_user_123"
      ],
    ).toEqual(["subscribe", "push-subscribe"]);
  });

  it("grants presence on each organization channel", () => {
    const capability = buildAblyClientCapability({
      userId: "user_123",
      roomIds: ["room-a"],
      organizationIds: ["org_a", "org_b"],
      notificationChannelEnvironment: NON_PREVIEW_ENVIRONMENT,
    });

    expect(capability["presence:org_org_a"]).toEqual(["presence", "subscribe"]);
    expect(capability["presence:org_org_b"]).toEqual(["presence", "subscribe"]);
    expect(capability["chat_rooms:room_room-a"]).toEqual(["subscribe"]);
  });

  it("omits chat room channels when the user has no memberships", () => {
    const capability = buildAblyClientCapability({
      userId: "user_123",
      roomIds: [],
      organizationIds: [],
      notificationChannelEnvironment: NON_PREVIEW_ENVIRONMENT,
    });

    expect(capability["chat_rooms:room_anything"]).toBeUndefined();
    expect(
      Object.keys(capability).filter((k) => k.startsWith("chat_rooms:")),
    ).toEqual([]);
    expect(capability["tasks:all:user_user_123"]).toEqual(["subscribe"]);
    expect(capability["chat_control:user_user_123"]).toEqual(["subscribe"]);
  });

  it("does not grant the legacy per-user chat_rooms wildcard", () => {
    const capability = buildAblyClientCapability({
      userId: "user_123",
      roomIds: ["room-a"],
      organizationIds: [],
      notificationChannelEnvironment: NON_PREVIEW_ENVIRONMENT,
    });

    expect(capability["chat_rooms:*:user_user_123"]).toBeUndefined();
    expect(capability["chat_rooms:all:user_user_123"]).toBeUndefined();
  });
});
