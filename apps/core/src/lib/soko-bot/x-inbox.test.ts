import { describe, expect, it } from "vitest";
import {
  type XInboxEntry,
  xInboxEntries,
  xInboxMessageDetail,
  xInboxMessages,
} from "./x-inbox";

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
