import { describe, expect, it } from "vitest";
import {
  type ContactActor,
  contactFilterWhere,
  normalizeChannels,
  parseSmartFilter,
} from "./contacts.service";

const actor: ContactActor = {
  workspaceId: "0199f1c2-7a3b-7c1d-9e2f-000000000001",
  userId: "user_me",
  sokoBotId: null,
};

describe("normalizeChannels", () => {
  it("normalizes, drops repeats and keeps provenance", () => {
    expect(
      normalizeChannels([
        { type: "EMAIL", value: "Nina@Example.com", source: "WEB_RESEARCH" },
        { type: "EMAIL", value: "nina@example.com " },
        {
          type: "LINKEDIN",
          value: "linkedin.com/in/Nina",
          sourceUrl: "https://example.com/team",
          verified: true,
        },
      ]),
    ).toEqual([
      {
        type: "EMAIL",
        value: "nina@example.com",
        label: null,
        isPrimary: undefined,
        source: "WEB_RESEARCH",
        sourceUrl: null,
        verified: false,
      },
      {
        type: "LINKEDIN",
        value: "https://www.linkedin.com/in/nina",
        label: null,
        isPrimary: undefined,
        source: undefined,
        sourceUrl: "https://example.com/team",
        verified: true,
      },
    ]);
  });

  it("refuses an address that is not one", () => {
    expect(() =>
      normalizeChannels([{ type: "PHONE", value: "ask reception" }]),
    ).toThrow(/not a valid phone channel/);
  });
});

describe("contactFilterWhere", () => {
  const now = new Date("2026-10-22T15:30:00.000Z");

  it("reads 'me' as the actor and relative days from now", () => {
    expect(
      contactFilterWhere(
        actor,
        {
          knownByMe: true,
          lastContactOlderThanDays: 90,
          createdWithinDays: 7,
          followUpDue: true,
        },
        now,
      ),
    ).toEqual([
      { interactions: { some: { userId: "user_me" } } },
      { lastContactAt: { lt: new Date("2026-07-24T15:30:00.000Z") } },
      { createdAt: { gte: new Date("2026-10-15T15:30:00.000Z") } },
      { followUpAt: { lte: new Date("2026-10-22T00:00:00.000Z") } },
    ]);
  });

  it("searches name, organization and channel values without case", () => {
    const [search] = contactFilterWhere(actor, { search: "acme" }, now);
    expect(search).toEqual({
      OR: [
        { name: { contains: "acme", mode: "insensitive" } },
        { organization: { contains: "acme", mode: "insensitive" } },
        {
          channels: {
            some: { value: { contains: "acme", mode: "insensitive" } },
          },
        },
      ],
    });
  });

  it("is empty for an empty filter", () => {
    expect(contactFilterWhere(actor, {}, now)).toEqual([]);
  });
});

describe("parseSmartFilter", () => {
  it("reads a manual list as null and refuses a broken filter", () => {
    expect(parseSmartFilter(null)).toBeNull();
    expect(parseSmartFilter({ stages: ["LEAD"] })).toEqual({
      stages: ["LEAD"],
    });
    expect(() => parseSmartFilter({ stages: ["NOPE"] })).toThrow();
  });
});
