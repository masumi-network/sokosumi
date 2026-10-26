import { TaskVisibility } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  buildSokoBotScopeJobWhere,
  buildSokoBotScopeTaskWhere,
} from "@/helpers/task-visibility";
import { contextPacketScope } from "./context-packet-scope";

const BOT = "bot-1";
const WS = "ws-1";
const personal = {
  userId: "owner",
  sokoBotId: BOT,
  workspaceId: WS,
  sharedScope: null,
};
const projectScope = { sokoBotId: BOT, workspaceId: WS, projectId: "p-1" };
const shared = { ...personal, userId: "member", sharedScope: projectScope };

describe("contextPacketScope", () => {
  it("keeps a personal owner packet on the owner's view", () => {
    const scope = contextPacketScope(personal);
    expect(scope.askedByKind).toBe("OWNER");
    expect(scope.includeReminders).toBe(true);
    expect(scope.taskWhere).toEqual({
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, ownerId: "owner" },
      ],
    });
    expect(scope.jobWhere).toMatchObject({ ownerId: "owner" });
    expect(scope.memoryWhere).toEqual({
      sokoBotId: BOT,
      sokoBot: { userId: "owner" },
    });
    expect(scope.projectWhere).toEqual({ workspaceId: WS });
  });

  it("keeps a personal teammate packet public", () => {
    const scope = contextPacketScope({
      ...personal,
      audience: "TEAMMATE",
      askedByKind: "TEAMMATE",
      askedByUserId: "teammate",
    });
    expect(scope.taskWhere).toEqual({ visibility: TaskVisibility.PUBLIC });
    expect(scope.includeReminders).toBe(false);
    expect(scope.askerUserId).toBe("teammate");
    expect(scope.recentTurnWhere).toMatchObject({
      requestedByUserId: "owner",
      askedByUserId: "teammate",
    });
  });

  it.each([
    ["OWNER", "TEAMMATE"],
    [undefined, "TEAMMATE"],
    ["TEAMMATE", "TEAMMATE"],
    ["ASSISTANT", "ASSISTANT"],
  ] as const)(
    "never writes OWNER for a shared bot (asked by %s)",
    (askedByKind, expected) => {
      const scope = contextPacketScope({ ...shared, askedByKind });
      expect(scope.askedByKind).toBe(expected);
    },
  );

  it("reads a shared bot's scope, never the member's private view", () => {
    const scope = contextPacketScope({ ...shared, roomId: "room-1" });
    expect(scope.taskWhere).toEqual(buildSokoBotScopeTaskWhere(projectScope));
    expect(scope.jobWhere).toEqual(buildSokoBotScopeJobWhere(projectScope));
    expect(scope.projectWhere).toEqual({ workspaceId: WS, id: "p-1" });
    expect(scope.coworkerAssignmentWhere).toEqual({ id: { in: [] } });
    expect(scope.includeReminders).toBe(true);
    expect(scope.askerUserId).toBe("member");
    // One memory and one conversation per bot, keyed on the bot.
    expect(scope.memoryWhere).toEqual({ sokoBotId: BOT });
    expect(scope.recentTurnWhere).toEqual({
      sokoBotId: BOT,
      workspaceId: WS,
      status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
      // A background run's report lands in the room it was started from.
      OR: [
        { chatMention: { message: { roomId: "room-1" } } },
        { parentTurnId: { not: null }, destinationRoomId: "room-1" },
        // So is what a briefing, inbox check or schedule published there.
        {
          chatMentionId: null,
          destinationRoomId: "room-1",
          deliveries: {
            some: { purpose: "FINAL", status: "PUBLISHED", roomId: "room-1" },
          },
        },
      ],
    });
    // Only the asker may answer a decision, so the packet shows only theirs.
    expect(scope.pendingDecisionWhere()).toMatchObject({
      requestedByUserId: "member",
      sokoBotId: BOT,
      workspaceId: WS,
      turn: { chatMention: { message: { roomId: "room-1" } } },
    });
  });

  it.each(["SCHEDULE", "EVENT", "INGEST"])(
    "names no asker for a shared bot's %s turn",
    (source) => {
      const scope = contextPacketScope({ ...shared, source });
      expect(scope.askedByKind).toBe("TEAMMATE");
      expect(scope.askerUserId).toBeNull();
    },
  );

  it("names the asking member for a shared bot's chat turn", () => {
    const scope = contextPacketScope({ ...shared, source: "CHAT" });
    expect(scope.askerUserId).toBe("member");
  });

  it("lets a workspace bot see every Project", () => {
    const scope = contextPacketScope({
      ...shared,
      sharedScope: { ...projectScope, projectId: null },
    });
    expect(scope.projectWhere).toEqual({ workspaceId: WS });
  });

  it("does not name another assistant's owner", () => {
    const scope = contextPacketScope({
      ...shared,
      askedByKind: "ASSISTANT",
      askedByUserId: "other-owner",
    });
    expect(scope.askerUserId).toBeNull();
  });

  it("refuses a scope from another bot or workspace", () => {
    expect(() =>
      contextPacketScope({
        ...shared,
        sharedScope: { ...projectScope, sokoBotId: "other" },
      }),
    ).toThrow("Soko Bot scope does not match the packet");
    expect(() =>
      contextPacketScope({
        ...shared,
        sharedScope: { ...projectScope, workspaceId: "other" },
      }),
    ).toThrow("Soko Bot scope does not match the packet");
  });
});
