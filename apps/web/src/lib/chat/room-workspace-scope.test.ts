import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { isShownInEveryWorkspace } from "./room-workspace-scope";

type ScopedRoom = Parameters<typeof isShownInEveryWorkspace>[0];

const channel = (overrides: Partial<ScopedRoom>): ScopedRoom => ({
  organizationId: "org-1",
  kind: "channel",
  discoverability: "public",
  myAccess: "member",
  coworkerMembers: [],
  sokoBotMembers: [],
  ...overrides,
});

const direct = (overrides: Partial<ScopedRoom>): ScopedRoom =>
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
