import { beforeEach, describe, expect, it, vi } from "vitest";

const { channelFindMany, groupBy, userFindMany } = vi.hoisted(() => ({
  channelFindMany: vi.fn(),
  groupBy: vi.fn(),
  userFindMany: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    contactChannel: { findMany: channelFindMany },
    contactInteraction: { groupBy },
    user: { findMany: userFindMany },
  },
}));

import {
  calendarPeopleBlock,
  contactLinesByEmail,
  emailsIn,
} from "./contacts-context.service";

const nina = {
  id: "c-1",
  name: "Nina Keller",
  organization: "Acme",
  role: "CEO",
  stage: "PARTNER",
  summary: "Runs the   EU pilot.",
  listMemberships: [{ list: { name: "Pilots" } }, { list: { name: "VIP" } }],
  interactions: [
    {
      occurredAt: new Date("2026-10-02T09:00:00Z"),
      channel: "MEETING",
      summary: "Pilot kickoff",
      user: { name: "Bob" },
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  channelFindMany.mockResolvedValue([
    { value: "nina@acme.com", contact: nina },
  ]);
  groupBy.mockResolvedValue([
    { contactId: "c-1", userId: "u-alice", _count: { _all: 1 } },
    { contactId: "c-1", userId: "u-bob", _count: { _all: 5 } },
  ]);
  userFindMany.mockResolvedValue([
    { id: "u-alice", name: "Alice" },
    { id: "u-bob", name: "Bob" },
  ]);
});

describe("contactLinesByEmail", () => {
  it("writes one compact line: who, stage, lists, who knows them, last touchpoint, about", async () => {
    const lines = await contactLinesByEmail({
      workspaceId: "ws-1",
      emails: ["Nina@Acme.com"],
      timeZone: "Europe/Zurich",
    });
    expect(lines.get("nina@acme.com")).toBe(
      'Nina Keller — CEO @ Acme · partner · lists: Pilots, VIP · known by Bob (5), Alice (1) · last: 2 Oct 2026, Bob, meeting "Pilot kickoff" · Runs the EU pilot. (contact c-1)',
    );
    expect(channelFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-1",
          value: { in: ["nina@acme.com"] },
          contact: { mergedIntoId: null, archivedAt: null },
        }),
      }),
    );
  });

  it("asks nothing for no addresses", async () => {
    expect(
      await contactLinesByEmail({
        workspaceId: "ws-1",
        emails: [],
        timeZone: "UTC",
      }),
    ).toEqual(new Map());
    expect(channelFindMany).not.toHaveBeenCalled();
  });
});

describe("calendarPeopleBlock", () => {
  it("lists the attendees who are contacts once, under one heading", async () => {
    const block = await calendarPeopleBlock({
      workspaceId: "ws-1",
      attendees: ["Nina <nina@acme.com>", "nina@acme.com", "stranger@x.io"],
      timeZone: "UTC",
    });
    expect(block[0]).toBe("## People on your calendar (from Contacts)");
    expect(
      block.filter((line) => line.startsWith("- Nina Keller")),
    ).toHaveLength(1);
  });

  it("is empty when nobody on the calendar is a contact", async () => {
    channelFindMany.mockResolvedValue([]);
    expect(
      await calendarPeopleBlock({
        workspaceId: "ws-1",
        attendees: ["stranger@x.io"],
        timeZone: "UTC",
      }),
    ).toEqual([]);
  });

  it("reads addresses in either form", () => {
    expect(
      emailsIn(["Nina <Nina@Acme.com>", "bob@x.io", "no address"]),
    ).toEqual(["nina@acme.com", "bob@x.io"]);
  });
});
