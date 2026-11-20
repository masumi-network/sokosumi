import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  marketingStrategy: { findFirst: vi.fn() },
  socialPost: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: prisma }));

import {
  findStyleReferences,
  infographicSuits,
  monthStyleReferenceIds,
} from "@/services/reference-library.service";

const embed = async () => ({ embeddings: [[0.1, 0.2]], costUsd: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([]);
});

// NMKR's month (2026-11-20): the search kept offering references other
// pieces already had, and 8 saves were refused for it.
describe("a month's style references", () => {
  it("are left out of the search, so every result is free to use", async () => {
    await findStyleReferences(
      { about: "a mint workflow", exclude: ["ref-taken"] },
      embed as never,
    );
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0] ?? [];
    expect((sql as string[]).join("?")).toContain('NOT ("id"::text = ANY(');
    expect(values).toContainEqual(["ref-taken"]);
  });

  it("are read from the approved month's live posts and its file pieces", async () => {
    prisma.marketingStrategy.findFirst.mockResolvedValue({
      id: "version-1",
      plan: {
        calendar: [{ id: "ad-1", styleReferenceId: "ref-ad" }, { id: "x-1" }],
      },
    });
    prisma.socialPost.findMany.mockResolvedValue([
      { planning: { id: "x-2", styleReferenceId: "ref-post" } },
      { planning: { id: "x-3", styleReferenceId: "ref-post" } },
      { planning: null },
    ]);
    await expect(monthStyleReferenceIds("project-1")).resolves.toEqual([
      "ref-post",
      "ref-ad",
    ]);
    expect(prisma.socialPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          marketingStrategyId: "version-1",
          status: { not: "CANCELED" },
        },
      }),
    );
  });

  it("are none before a month is approved", async () => {
    prisma.marketingStrategy.findFirst.mockResolvedValue(null);
    await expect(monthStyleReferenceIds("project-1")).resolves.toEqual([]);
  });
});

// cmo-v8: an infographic only for a picture that shows numbers.
describe("infographics", () => {
  it("are left out of a search that does not want them", async () => {
    await findStyleReferences(
      { about: "three steps of a mint", infographics: false },
      embed as never,
    );
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0] ?? [];
    expect((sql as string[]).join("?")).toContain('AND NOT ("kind" = ANY(');
    expect(values).toContainEqual(["infographic"]);
  });

  it("are kept by default", async () => {
    await findStyleReferences({ about: "fees by plan" }, embed as never);
    const [, ...values] = prisma.$queryRaw.mock.calls[0] ?? [];
    expect(values).not.toContainEqual(["infographic"]);
  });

  it("suit data and comparisons only", () => {
    expect(infographicSuits("data")).toBe(true);
    expect(infographicSuits("comparison")).toBe(true);
    expect(infographicSuits("how-to")).toBe(false);
    expect(infographicSuits(undefined)).toBe(false);
  });
});
