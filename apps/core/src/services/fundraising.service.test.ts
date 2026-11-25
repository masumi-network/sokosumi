import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dataRoomMember: { findMany: vi.fn() },
  dataRoomEvent: { groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));
vi.mock("@/services/contacts.service", () => ({
  CONTACT_INCLUDE: {},
  contactDtos: vi.fn(),
}));

import {
  dataRoomVisits,
  fundraisingEnabled,
  requireFundraising,
} from "./fundraising.service";

const ORG = "cmayzk8f60002v7jg66bmvsg3";

function contact(id: string, emails: string[]) {
  return {
    id,
    channels: emails.map((value, index) => ({
      id: `${id}-${index}`,
      type: "EMAIL",
      value,
    })),
  } as unknown as Parameters<typeof dataRoomVisits>[1][number];
}

const rooms = [
  {
    id: "11111111-1111-7111-8111-111111111111",
    title: null,
    folderPath: "Sumico/Seed Round 2026",
    token: "t1",
  },
  {
    id: "22222222-2222-7222-8222-222222222222",
    title: "Old room",
    folderPath: "Old",
    token: "t2",
  },
];

describe("fundraisingEnabled", () => {
  beforeEach(() => {
    process.env.FUNDRAISING_ORGANIZATION_IDS = `${ORG}, other-org`;
  });

  it("is on only for listed organizations", () => {
    expect(fundraisingEnabled(ORG)).toBe(true);
    expect(fundraisingEnabled("other-org")).toBe(true);
    expect(fundraisingEnabled("someone-else")).toBe(false);
    expect(fundraisingEnabled(null)).toBe(false);
  });

  it("answers 404 for everyone else, so the pages do not exist for them", () => {
    expect(requireFundraising(ORG)).toBe(ORG);
    expect(() => requireFundraising("someone-else")).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => requireFundraising(null)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});

describe("dataRoomVisits", () => {
  beforeEach(() => {
    prismaMock.dataRoomMember.findMany.mockReset();
    prismaMock.dataRoomEvent.groupBy.mockReset();
    prismaMock.dataRoomEvent.findMany.mockReset();
  });

  it("asks nothing when there is no room or no email to match", async () => {
    expect(await dataRoomVisits([], [contact("c1", ["a@fund.com"])])).toEqual(
      new Map(),
    );
    expect(await dataRoomVisits(rooms, [contact("c1", [])])).toEqual(new Map());
    expect(prismaMock.dataRoomMember.findMany).not.toHaveBeenCalled();
  });

  it("matches members by email, counts what they did and keeps the room they visited last", async () => {
    const invitedAt = new Date("2026-11-01T10:00:00Z");
    prismaMock.dataRoomMember.findMany.mockResolvedValue([
      {
        id: "m-old",
        roomId: rooms[1]?.id,
        email: "ann@fund.com",
        createdAt: invitedAt,
        firstVisitAt: new Date("2026-11-02T10:00:00Z"),
        lastVisitAt: new Date("2026-11-02T10:00:00Z"),
        revokedAt: null,
      },
      {
        id: "m-new",
        roomId: rooms[0]?.id,
        email: "ann@fund.com",
        createdAt: invitedAt,
        firstVisitAt: new Date("2026-11-10T10:00:00Z"),
        lastVisitAt: new Date("2026-11-20T10:00:00Z"),
        revokedAt: null,
      },
      {
        id: "m-bob",
        roomId: rooms[0]?.id,
        email: "bob@vc.com",
        createdAt: invitedAt,
        firstVisitAt: null,
        lastVisitAt: null,
        revokedAt: new Date("2026-11-21T10:00:00Z"),
      },
    ]);
    prismaMock.dataRoomEvent.groupBy.mockResolvedValue([
      { memberId: "m-new", kind: "VIEW", _count: { _all: 4 } },
      { memberId: "m-new", kind: "DOWNLOAD", _count: { _all: 1 } },
      { memberId: "m-new", kind: "DOWNLOAD_ALL", _count: { _all: 1 } },
      { memberId: "m-new", kind: "ENTER", _count: { _all: 3 } },
      { memberId: "m-old", kind: "VIEW", _count: { _all: 1 } },
    ]);
    prismaMock.dataRoomEvent.findMany.mockResolvedValue([
      { memberId: "m-new", path: "Financials/Forecast.pdf" },
      { memberId: "m-old", path: "Intro.pdf" },
    ]);

    const visits = await dataRoomVisits(rooms, [
      contact("ann", ["Ann@Fund.com"]),
      contact("bob", ["bob@vc.com"]),
      contact("nobody", ["x@y.com"]),
    ]);

    expect(prismaMock.dataRoomMember.findMany).toHaveBeenCalledWith({
      where: {
        roomId: { in: rooms.map((room) => room.id) },
        email: { in: ["ann@fund.com", "bob@vc.com", "x@y.com"] },
      },
    });
    expect(visits.get("ann")).toEqual({
      roomId: rooms[0]?.id,
      roomTitle: "Seed Round 2026",
      memberId: "m-new",
      email: "ann@fund.com",
      invitedAt,
      firstVisitAt: new Date("2026-11-10T10:00:00Z"),
      lastVisitAt: new Date("2026-11-20T10:00:00Z"),
      views: 4,
      downloads: 2,
      lastOpened: "Financials/Forecast.pdf",
      revoked: false,
    });
    expect(visits.get("bob")).toMatchObject({
      roomTitle: "Seed Round 2026",
      views: 0,
      downloads: 0,
      lastOpened: null,
      revoked: true,
    });
    expect(visits.has("nobody")).toBe(false);
  });
});
