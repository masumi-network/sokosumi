import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  isListedInWorkspace,
  isRoomOfWorkspace,
  isShownInEveryWorkspace,
  type RoomWorkspaceScope,
} from "./room-workspace-scope";

const channel = (
  overrides: Partial<RoomWorkspaceScope>,
): RoomWorkspaceScope => ({
  organizationId: "org-1",
  kind: "channel",
  discoverability: "public",
  myAccess: "member",
  coworkerMembers: [],
  sokoBotMembers: [],
  ...overrides,
});

const direct = (overrides: Partial<RoomWorkspaceScope>): RoomWorkspaceScope =>
  channel({ kind: "direct", discoverability: null, ...overrides });

const coworker = { id: "cow-1" } as ChatRoom["coworkerMembers"][number];
const sokoBot = { id: "bot-1" } as ChatRoom["sokoBotMembers"][number];

describe("isShownInEveryWorkspace", () => {
  it.each([
    [
      "an External channel the host owns",
      channel({ discoverability: "external" }),
    ],
    [
      "an External channel the reader is a Guest in",
      channel({ discoverability: "external", myAccess: "guest" }),
    ],
    [
      "an org-less matched channel the reader is a member of",
      channel({ organizationId: null, discoverability: "matched" }),
    ],
    ["a Personal Direct", direct({ organizationId: null })],
  ])("shows %s in every workspace", (_name, room) => {
    expect(isShownInEveryWorkspace(room)).toBe(true);
  });

  it.each([
    ["an Organization's public channel", channel({})],
    [
      "an Organization's matched channel",
      channel({ discoverability: "matched" }),
    ],
    [
      "an org-less matched channel the reader is not a member of",
      channel({
        organizationId: null,
        discoverability: "matched",
        myAccess: "guest",
      }),
    ],
    ["a Direct an Organization owns", direct({})],
    [
      "a Coworker 1:1",
      direct({ organizationId: null, coworkerMembers: [coworker] }),
    ],
    [
      "a Soko Bot Direct",
      direct({ organizationId: null, sokoBotMembers: [sokoBot] }),
    ],
  ])("keeps %s in its own workspace", (_name, room) => {
    expect(isShownInEveryWorkspace(room)).toBe(false);
  });
});

describe("isRoomOfWorkspace", () => {
  it.each([
    ["its Organization's workspace", channel({}), "org-1"],
    [
      "the personal workspace, for a Coworker 1:1",
      direct({ organizationId: null, coworkerMembers: [coworker] }),
      null,
    ],
    [
      "any workspace, for an External channel",
      channel({ discoverability: "external" }),
      "org-2",
    ],
    [
      "any workspace, for a Personal Direct",
      direct({ organizationId: null }),
      "org-2",
    ],
  ])("belongs to %s", (_name, room, workspaceId) => {
    expect(isRoomOfWorkspace(room, workspaceId)).toBe(true);
  });

  it.each([
    ["another Organization's workspace", channel({}), "org-2"],
    [
      "the personal workspace, for an Organization's channel",
      channel({}),
      null,
    ],
    [
      "an Organization's workspace, for a Coworker 1:1",
      direct({ organizationId: null, coworkerMembers: [coworker] }),
      "org-1",
    ],
  ])("is a Room visit from %s", (_name, room, workspaceId) => {
    expect(isRoomOfWorkspace(room, workspaceId)).toBe(false);
  });
});

describe("isListedInWorkspace", () => {
  const pinned = { starredAt: new Date("2026-08-01T00:00:00.000Z") };
  const unpinned = { starredAt: null };

  it("lists a pinned room in every workspace", () => {
    expect(isListedInWorkspace({ ...channel({}), ...pinned }, "org-3")).toBe(
      true,
    );
    expect(isListedInWorkspace({ ...channel({}), ...pinned }, null)).toBe(true);
  });

  it("lists an unpinned room only where it belongs", () => {
    const room = { ...channel({}), ...unpinned };
    expect(isListedInWorkspace(room, "org-3")).toBe(false);
    expect(isListedInWorkspace(room, "org-1")).toBe(true);
    expect(
      isListedInWorkspace(
        { ...channel({ discoverability: "external" }), ...unpinned },
        "org-3",
      ),
    ).toBe(true);
  });

  // The room's own Organization still decides its roster and role, and a
  // `#general` in it must not resolve to the active workspace's.
  it("leaves a pinned room of another workspace a Room visit", () => {
    expect(isRoomOfWorkspace({ ...channel({}), ...pinned }, "org-3")).toBe(
      false,
    );
  });
});
