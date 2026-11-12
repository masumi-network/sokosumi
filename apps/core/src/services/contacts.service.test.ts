import { describe, expect, it, vi } from "vitest";
import {
  assertFilterBudget,
  boundListValues,
  type ContactActor,
  contactFilterWhere,
  contactListWhere,
  normalizeChannels,
  parseSmartFilter,
} from "./contacts.service";

const { queryRaw, findList } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findList: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { $queryRaw: queryRaw, contactList: { findFirst: findList } },
}));

/** The SQL text of a `$queryRaw` call, tagged template or `Sql` object. */
function sqlOf(first: unknown): string {
  if (Array.isArray(first)) return first.join("?");
  return (first as { sql: string }).sql;
}

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

  it("reads 'me' as the actor and relative days from now", async () => {
    expect(
      await contactFilterWhere(
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

  it("searches name, organization, channel values and location without case", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const [search] = await contactFilterWhere(actor, { search: "acme" }, now);
    expect(search).toEqual({
      OR: [
        { name: { contains: "acme", mode: "insensitive" } },
        { organization: { contains: "acme", mode: "insensitive" } },
        {
          channels: {
            some: { value: { contains: "acme", mode: "insensitive" } },
          },
        },
        { location: { contains: "acme", mode: "insensitive" } },
      ],
    });
  });

  it("adds the places only unaccent matches, as their spellings", async () => {
    queryRaw.mockResolvedValueOnce([
      { location: "Zürich" },
      { location: "Zürich, Switzerland" },
    ]);
    const [search] = await contactFilterWhere(actor, { search: "zurich" }, now);
    expect(search?.OR?.at(-1)).toEqual({
      OR: [
        { location: { contains: "zurich", mode: "insensitive" } },
        { location: { in: ["Zürich", "Zürich, Switzerland"] } },
      ],
    });
    const sql = sqlOf(queryRaw.mock.calls.at(-1)?.[0]);
    expect(sql).toContain('unaccent("location") ILIKE unaccent(');
    expect(sql).toContain('"location" NOT ILIKE');
    expect(sql).toContain('"mergedIntoId" IS NULL');
  });

  it("is empty for an empty filter", async () => {
    expect(await contactFilterWhere(actor, {}, now)).toEqual([]);
  });
});

describe("filter parameter budget", () => {
  const values = (count: number, prefix = "v") =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`);

  it("counts list values at any depth", () => {
    expect(
      boundListValues({
        AND: [
          { id: { in: values(3) } },
          {
            OR: [{ location: { in: values(2) } }, { name: { contains: "x" } }],
          },
          { stage: { notIn: values(1) } },
        ],
      }),
    ).toBe(6);
  });

  it("allows exactly 50,000 values and refuses one more", () => {
    const at = { AND: [{ id: { in: values(50_000) } }] };
    expect(assertFilterBudget(at)).toBe(at);
    expect(() =>
      assertFilterBudget({
        AND: [{ id: { in: values(49_999) } }, { location: { in: ["x", "y"] } }],
      }),
    ).toThrow(/too many places or people/);
  });

  it("budgets a search, a smart list's search and a company together", async () => {
    findList.mockResolvedValueOnce({
      id: "list-1",
      smartFilter: { search: "munchen" },
    });
    // Each part fits alone; together they would overflow the driver.
    queryRaw.mockImplementation((first: unknown) => {
      const sql = sqlOf(first);
      if (sql.includes('SELECT DISTINCT "location"'))
        return Promise.resolve(
          values(20_000, sql.length.toString()).map((location) => ({
            location,
          })),
        );
      if (sql.includes("FROM assigned"))
        return Promise.resolve(values(15_000, "id").map((id) => ({ id })));
      return Promise.resolve([]);
    });
    await expect(
      contactListWhere(actor, {
        filter: { search: "zurich" },
        listId: "list-1",
        company: "Acme",
      }),
    ).rejects.toThrow(/too many places or people/);
    queryRaw.mockReset();
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
