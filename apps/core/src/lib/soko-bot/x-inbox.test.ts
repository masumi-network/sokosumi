import { describe, expect, it } from "vitest";
import {
  onlyOwnerAndBot,
  type XInboxEntry,
  xDmToolKind,
  xInboxEntries,
  xInboxMessageDetail,
  xInboxMessages,
} from "./x-inbox";

describe("onlyOwnerAndBot", () => {
  const who = { ownerId: "owner", sokoBotId: "bot" };
  const room = (
    overrides: Partial<Parameters<typeof onlyOwnerAndBot>[0]> = {},
  ) => ({
    kind: "direct",
    userMembers: [{ userId: "owner" }],
    coworkerMembers: [],
    sokoBotMembers: [{ sokoBotId: "bot" }],
    ...overrides,
  });

  it("allows the owner's own chat with the bot", () => {
    expect(onlyOwnerAndBot(room(), who)).toBe(true);
  });

  it("refuses a direct room with another person, Coworker or bot in it", () => {
    for (const other of [
      room({ userMembers: [{ userId: "owner" }, { userId: "colleague" }] }),
      room({ userMembers: [{ userId: "colleague" }] }),
      room({ coworkerMembers: [{ coworkerId: "cw" }] }),
      room({ sokoBotMembers: [{ sokoBotId: "bot" }, { sokoBotId: "juno" }] }),
      room({ kind: "channel" }),
    ])
      expect(onlyOwnerAndBot(other, who)).toBe(false);
  });
});

describe("xDmToolKind", () => {
  it("reads only what says it reads; any other DM tool is a write", () => {
    expect(
      [
        "TWITTER_GET_RECENT_DM_EVENTS",
        "TWITTER_RETRIEVE_DM_CONVERSATION_EVENTS",
        "TWITTER_GET_DM_EVENTS_BY_ID",
        "TWITTER_SEND_A_NEW_MESSAGE_TO_A_USER",
        "TWITTER_SEND_A_NEW_MESSAGE_TO_A_DM_CONVERSATION",
        "TWITTER_CREATE_A_NEW_DM_CONVERSATION",
        "TWITTER_DELETE_DM",
        "twitter_create_direct_message",
        "TWITTER_CREATION_OF_A_POST",
        "TWITTER_USER_LOOKUP_ME",
        "SLACK_SEND_MESSAGE",
      ].map(xDmToolKind),
    ).toEqual([
      "read",
      "read",
      "read",
      "write",
      "write",
      "write",
      "write",
      "write",
      null,
      null,
      null,
    ]);
  });
});

const entry = (
  id: string,
  createdAt: string,
  fromOwner = false,
  conversationId = "1-2",
): XInboxEntry => ({
  id,
  conversationId,
  from: fromOwner ? "Owner (@owner)" : "Ruth Weber (@ruthw)",
  createdAt,
  text: `text ${id}`,
  fromOwner,
});

describe("xInboxEntries", () => {
  it("reads only what is inside the window, however long ago capture last pruned", () => {
    const cursor = {
      xDms: [
        { ...entry("new", "2026-11-25T20:00:00.000Z") },
        { ...entry("old", "2026-11-24T10:00:00.000Z") },
      ],
    };
    expect(
      xInboxEntries(cursor, new Date("2026-11-26T08:00:00.000Z")).map(
        (kept) => kept.id,
      ),
    ).toEqual(["new"]);
    expect(xInboxEntries(cursor, new Date("2026-11-28T08:00:00.000Z"))).toEqual(
      [],
    );
  });
});

describe("xInboxMessages", () => {
  const entries = [
    entry("a", "2026-11-25T08:00:00.000Z"),
    entry("b", "2026-11-25T09:00:00.000Z", true),
    entry("c", "2026-11-25T10:00:00.000Z"),
    entry("d", "2026-11-25T07:00:00.000Z", false, "1-3"),
  ];

  it("lists what others wrote, newest first, and marks what the owner answered", () => {
    expect(
      xInboxMessages(entries).map((m) => [m.id, m.repliedAt ?? null, m.unread]),
    ).toEqual([
      ["c", null, true],
      ["a", "2026-11-25T09:00:00.000Z", false],
      ["d", null, true],
    ]);
  });

  it("keeps only messages after since", () => {
    expect(
      xInboxMessages(entries, new Date("2026-11-25T07:30:00.000Z")).map(
        (m) => m.id,
      ),
    ).toEqual(["c", "a"]);
  });

  it("reads one message in full, never the owner's own", () => {
    expect(xInboxMessageDetail(entries, "c")).toMatchObject({
      provider: "twitter",
      from: "Ruth Weber (@ruthw)",
      body: "text c",
      attachments: [],
    });
    expect(xInboxMessageDetail(entries, "b")).toBeNull();
  });
});
