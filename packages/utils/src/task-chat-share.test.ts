import { describe, expect, it } from "vitest";

import {
  type TaskChatRoomAudience,
  taskChatMessage,
  taskChatRoomRefusal,
} from "./task-chat-share.js";

const channel: TaskChatRoomAudience = {
  kind: "channel",
  organizationId: "org-1",
  discoverability: "public",
  isSelfDirect: false,
  hasAgentMembers: false,
  hasGuests: false,
};
const notes: TaskChatRoomAudience = {
  kind: "direct",
  organizationId: null,
  discoverability: null,
  isSelfDirect: true,
  hasAgentMembers: false,
  hasGuests: false,
};

describe("taskChatRoomRefusal", () => {
  it("allows the Task organization's rooms and the sender's notes", () => {
    expect(taskChatRoomRefusal(channel, "org-1")).toBeNull();
    expect(
      taskChatRoomRefusal({ ...channel, discoverability: "private" }, "org-1"),
    ).toBeNull();
    expect(
      taskChatRoomRefusal(
        { ...channel, kind: "direct", discoverability: null },
        "org-1",
      ),
    ).toBeNull();
    expect(taskChatRoomRefusal(notes, "org-1")).toBeNull();
    expect(taskChatRoomRefusal(notes, null)).toBeNull();
  });

  it("refuses rooms with a Coworker or Soko Bot, even notes", () => {
    expect(
      taskChatRoomRefusal({ ...channel, hasAgentMembers: true }, "org-1"),
    ).toBe("agent-members");
    expect(taskChatRoomRefusal({ ...notes, hasAgentMembers: true }, null)).toBe(
      "agent-members",
    );
  });

  it("refuses external, matched and guest rooms", () => {
    expect(
      taskChatRoomRefusal({ ...channel, discoverability: "external" }, "org-1"),
    ).toBe("guests");
    expect(
      taskChatRoomRefusal(
        { ...channel, discoverability: "matched", organizationId: null },
        "org-1",
      ),
    ).toBe("guests");
    expect(taskChatRoomRefusal({ ...channel, hasGuests: true }, "org-1")).toBe(
      "guests",
    );
  });

  it("refuses rooms outside the Task's organization", () => {
    expect(
      taskChatRoomRefusal({ ...channel, organizationId: "org-2" }, "org-1"),
    ).toBe("other-workspace");
    expect(
      taskChatRoomRefusal(
        { ...channel, kind: "direct", organizationId: null },
        "org-1",
      ),
    ).toBe("other-workspace");
    expect(taskChatRoomRefusal(channel, null)).toBe("other-workspace");
  });
});

describe("taskChatMessage", () => {
  const id = "0190a000-0000-7000-8000-000000000001";

  it("puts the note above an escaped link to the Task id", () => {
    expect(
      taskChatMessage(
        { id, identifier: "SOK-12", name: "Fix [login] *now*" },
        "  Can someone take this?  ",
      ),
    ).toBe(
      `Can someone take this?\n\n[SOK-12 Fix \\[login\\] \\*now\\*](/tasks/${id})`,
    );
  });

  it("sends the link alone without a note", () => {
    expect(taskChatMessage({ id, identifier: null, name: "Plan" }, " ")).toBe(
      `[Plan](/tasks/${id})`,
    );
  });
});
