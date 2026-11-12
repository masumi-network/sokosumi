import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { chatRoomsForTask } from "./task-chat-share";

function room(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id,
    organizationId: "org-1",
    kind: "channel",
    isSelfDirect: false,
    isReadOnly: false,
    discoverability: "public",
    userMembers: [],
    coworkerMembers: [],
    sokoBotMembers: [],
    ...overrides,
  } as ChatRoom;
}

const notes = room("notes", {
  kind: "direct",
  isSelfDirect: true,
  organizationId: null,
  discoverability: null,
});

describe("chatRoomsForTask", () => {
  const rooms = [
    room("public"),
    room("private", { discoverability: "private" }),
    room("org-direct", { kind: "direct", discoverability: null }),
    notes,
    room("external", { discoverability: "external" }),
    room("matched", { discoverability: "matched", organizationId: null }),
    room("other-org", { organizationId: "org-2" }),
    room("personal-direct", {
      kind: "direct",
      organizationId: null,
      discoverability: null,
    }),
    room("read-only", { isReadOnly: true }),
    room("bot-direct", {
      kind: "direct",
      discoverability: null,
      sokoBotMembers: [{ id: "bot-1" }] as ChatRoom["sokoBotMembers"],
    }),
    room("coworker-channel", {
      coworkerMembers: [{ id: "cw-1" }] as ChatRoom["coworkerMembers"],
    }),
    room("guest-channel", {
      userMembers: [{ id: "g-1", access: "guest" }] as ChatRoom["userMembers"],
    }),
  ];

  it("keeps notes and the Task organization's human-only rooms", () => {
    expect(chatRoomsForTask(rooms, "org-1").map((r) => r.id)).toEqual([
      "public",
      "private",
      "org-direct",
      "notes",
    ]);
  });

  it("offers only notes for a personal Task", () => {
    expect(chatRoomsForTask(rooms, null).map((r) => r.id)).toEqual(["notes"]);
  });
});
