import { describe, expect, it } from "vitest";

import { buildAblySubscribeCapability } from "./subscribe-capability";

describe("buildAblySubscribeCapability", () => {
  it("grants user task/notification channels and per-room chat channels", () => {
    const capability = buildAblySubscribeCapability("user_123", [
      "room-a",
      "room-b",
    ]);

    expect(capability).toEqual({
      "agent_jobs:*:user_user_123": ["subscribe"],
      "tasks:all:user_user_123": ["subscribe"],
      "notifications:all:user_user_123": ["subscribe"],
      "chat_control:user_user_123": ["subscribe"],
      "chat_rooms:room_room-a": ["subscribe"],
      "chat_rooms:room_room-b": ["subscribe"],
    });
  });

  it("grants presence on each organization channel", () => {
    const capability = buildAblySubscribeCapability(
      "user_123",
      ["room-a"],
      ["org_a", "org_b"],
    );

    expect(capability["presence:org_org_a"]).toEqual(["presence"]);
    expect(capability["presence:org_org_b"]).toEqual(["presence"]);
    expect(capability["chat_rooms:room_room-a"]).toEqual(["subscribe"]);
  });

  it("omits chat room channels when the user has no memberships", () => {
    const capability = buildAblySubscribeCapability("user_123", []);

    expect(capability["chat_rooms:room_anything"]).toBeUndefined();
    expect(
      Object.keys(capability).filter((k) => k.startsWith("chat_rooms:")),
    ).toEqual([]);
    expect(capability["tasks:all:user_user_123"]).toEqual(["subscribe"]);
    expect(capability["chat_control:user_user_123"]).toEqual(["subscribe"]);
  });

  it("does not grant the legacy per-user chat_rooms wildcard", () => {
    const capability = buildAblySubscribeCapability("user_123", ["room-a"]);

    expect(capability["chat_rooms:*:user_user_123"]).toBeUndefined();
    expect(capability["chat_rooms:all:user_user_123"]).toBeUndefined();
  });
});
