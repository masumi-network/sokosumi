import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { chatRoomsForTask, taskChatMessage } from "./task-chat-share";

function room(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id,
    organizationId: "org-1",
    kind: "channel",
    isSelfDirect: false,
    isReadOnly: false,
    discoverability: "public",
    ...overrides,
  } as ChatRoom;
}

describe("chatRoomsForTask", () => {
  const rooms = [
    room("public"),
    room("private", { discoverability: "private" }),
    room("org-direct", { kind: "direct", discoverability: null }),
    room("notes", {
      kind: "direct",
      isSelfDirect: true,
      organizationId: null,
      discoverability: null,
    }),
    room("external", { discoverability: "external" }),
    room("matched", { discoverability: "matched", organizationId: null }),
    room("other-org", { organizationId: "org-2" }),
    room("personal-direct", {
      kind: "direct",
      organizationId: null,
      discoverability: null,
    }),
    room("read-only", { isReadOnly: true }),
  ];

  it("keeps notes and the Task organization's rooms without guests", () => {
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

  it("drops read-only notes", () => {
    expect(
      chatRoomsForTask(
        [room("notes", { isSelfDirect: true, isReadOnly: true })],
        "org-1",
      ),
    ).toEqual([]);
  });
});

describe("taskChatMessage", () => {
  const task = { id: "t-1", identifier: "SOK-12", name: "Fix [login] *now*" };

  it("puts the note above an escaped app-path link", () => {
    expect(taskChatMessage(task, "  Can someone take this?  ")).toBe(
      "Can someone take this?\n\n[SOK-12 Fix \\[login\\] \\*now\\*](/tasks/SOK-12-fix-login-now)",
    );
  });

  it("sends the link alone without a note", () => {
    expect(
      taskChatMessage({ id: "t-1", identifier: null, name: "Plan" }, " "),
    ).toBe("[Plan](/tasks/t-1)");
  });
});
