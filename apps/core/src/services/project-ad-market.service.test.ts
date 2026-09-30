import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import type { MarketKeyword } from "@/lib/ads/dataforseo";

const m = vi.hoisted(() => {
  const fns = {
    requireScopedProject: vi.fn(),
    requireLockedOpenProject: vi.fn(),
    fetchMarketKeywords: vi.fn(),
    profileFindUnique: vi.fn(),
    profileUpsert: vi.fn(),
    snapshotFindUnique: vi.fn(),
    snapshotUpsert: vi.fn(),
  };
  return {
    ...fns,
    tx: {
      projectAdMarketProfile: {
        findUnique: fns.profileFindUnique,
        upsert: fns.profileUpsert,
      },
      projectAdMarketSnapshot: {
        findUnique: fns.snapshotFindUnique,
        upsert: fns.snapshotUpsert,
      },
    },
  };
});

vi.mock("@/services/project-social-connections.service", () => ({
  requireScopedProject: m.requireScopedProject,
  requireLockedOpenProject: m.requireLockedOpenProject,
}));
vi.mock("@/lib/ads/dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/dataforseo")>()),
  fetchMarketKeywords: m.fetchMarketKeywords,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (client: typeof m.tx) => unknown) => run(m.tx),
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.tx }));

import {
  getProjectAdMarketProfile,
  listProjectAdMarketKeywords,
  setProjectAdMarketProfile,
} from "./project-ad-market.service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const scope = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
const NOW = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const storedProfile = {
  projectId: PROJECT_ID,
  keywords: ["Running Shoes", "trail"],
  locationCode: 2276,
  languageCode: "de",
  updatedAt: new Date("2026-09-30T10:00:00.000Z"),
};
const keyword: MarketKeyword = {
  keyword: "running shoes",
  searchVolume: 100,
  trend: [{ year: 2026, month: 8, searchVolume: 90 }],
  competition: "LOW",
  competitionIndex: 10,
  cpc: 1,
  lowTopOfPageBid: 0.5,
  highTopOfPageBid: 2,
};

function requestKey(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
const KEY = requestKey({
  keywords: ["running shoes", "trail"],
  locationCode: 2276,
  languageCode: "de",
});

describe("project ad market service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    m.requireScopedProject.mockResolvedValue(undefined);
    m.requireLockedOpenProject.mockResolvedValue(undefined);
    m.profileFindUnique.mockResolvedValue(storedProfile);
    m.fetchMarketKeywords.mockResolvedValue([keyword]);
    m.snapshotUpsert.mockImplementation(
      async (args: { create: { fetchedAt: Date } }) => ({
        fetchedAt: args.create.fetchedAt,
      }),
    );
  });
  afterEach(() => vi.useRealTimers());

  describe("profile", () => {
    it("returns null without a profile and maps the stored one", async () => {
      m.profileFindUnique.mockResolvedValueOnce(null);
      expect(await getProjectAdMarketProfile(scope)).toBeNull();
      expect(await getProjectAdMarketProfile(scope)).toEqual({
        keywords: ["Running Shoes", "trail"],
        countryCode: "DE",
        languageCode: "de",
        updatedAt: storedProfile.updatedAt,
      });
    });

    it("does not read the profile of a Project outside the Workspace", async () => {
      m.requireScopedProject.mockRejectedValue(notFound("Project not found"));
      await expect(getProjectAdMarketProfile(scope)).rejects.toMatchObject({
        status: 404,
      });
      expect(m.profileFindUnique).not.toHaveBeenCalled();
    });

    it("upserts the profile with the country's location code and case-insensitively deduped keywords", async () => {
      m.profileUpsert.mockResolvedValue(storedProfile);
      const profile = await setProjectAdMarketProfile({
        ...scope,
        keywords: ["Running Shoes", "trail", "running shoes"],
        countryCode: "DE",
        languageCode: "de",
      });
      const data = {
        keywords: ["Running Shoes", "trail"],
        locationCode: 2276,
        languageCode: "de",
      };
      expect(m.profileUpsert).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        create: { projectId: PROJECT_ID, ...data },
        update: data,
      });
      expect(m.requireLockedOpenProject).toHaveBeenCalledWith(
        m.tx,
        expect.objectContaining(scope),
      );
      expect(profile.countryCode).toBe("DE");
    });

    it("refuses to write on a closed or foreign Project", async () => {
      m.requireLockedOpenProject.mockRejectedValue(
        Object.assign(new Error("closed"), { status: 409 }),
      );
      await expect(
        setProjectAdMarketProfile({
          ...scope,
          keywords: ["a"],
          countryCode: "US",
          languageCode: "en",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(m.profileUpsert).not.toHaveBeenCalled();
    });
  });

  describe("keywords", () => {
    it("is 404 without a profile and never calls DataForSEO", async () => {
      m.profileFindUnique.mockResolvedValue(null);
      await expect(listProjectAdMarketKeywords(scope)).rejects.toMatchObject({
        status: 404,
      });
      expect(m.fetchMarketKeywords).not.toHaveBeenCalled();
    });

    it("fetches on a cache miss and stores the normalized keywords under the profile key", async () => {
      m.snapshotFindUnique.mockResolvedValue(null);
      const result = await listProjectAdMarketKeywords(scope);
      expect(m.fetchMarketKeywords).toHaveBeenCalledWith({
        keywords: ["Running Shoes", "trail"],
        locationCode: 2276,
        languageCode: "de",
      });
      expect(m.snapshotFindUnique).toHaveBeenCalledWith({
        where: {
          projectId_kind_requestKey: {
            projectId: PROJECT_ID,
            kind: "keywords",
            requestKey: KEY,
          },
        },
      });
      expect(m.snapshotUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            projectId: PROJECT_ID,
            kind: "keywords",
            requestKey: KEY,
            payload: [keyword],
            fetchedAt: NOW,
          }),
          update: { payload: [keyword], fetchedAt: NOW },
        }),
      );
      expect(result).toEqual({
        keywords: [keyword],
        currency: "USD",
        fetchedAt: NOW,
      });
    });

    it("serves a fresh snapshot without calling DataForSEO", async () => {
      const fetchedAt = new Date(NOW.getTime() - 23 * HOUR);
      m.snapshotFindUnique.mockResolvedValue({ payload: [keyword], fetchedAt });
      expect(await listProjectAdMarketKeywords(scope)).toEqual({
        keywords: [keyword],
        currency: "USD",
        fetchedAt,
      });
      expect(m.fetchMarketKeywords).not.toHaveBeenCalled();
      expect(m.snapshotUpsert).not.toHaveBeenCalled();
    });

    it("refetches a stale snapshot and bumps fetchedAt on update", async () => {
      m.snapshotFindUnique.mockResolvedValue({
        payload: [],
        fetchedAt: new Date(NOW.getTime() - 25 * HOUR),
      });
      const result = await listProjectAdMarketKeywords(scope);
      expect(m.fetchMarketKeywords).toHaveBeenCalledTimes(1);
      expect(m.snapshotUpsert.mock.calls[0]?.[0].update.fetchedAt).toEqual(NOW);
      expect(result.fetchedAt).toEqual(NOW);
    });

    it("refetches when the cached payload no longer parses", async () => {
      m.snapshotFindUnique.mockResolvedValue({
        payload: [{ keyword: 1 }],
        fetchedAt: NOW,
      });
      await listProjectAdMarketKeywords(scope);
      expect(m.fetchMarketKeywords).toHaveBeenCalledTimes(1);
    });

    it("keys the cache on the profile: a change looks up a different snapshot", async () => {
      m.snapshotFindUnique.mockResolvedValue(null);
      await listProjectAdMarketKeywords(scope);
      m.profileFindUnique.mockResolvedValue({
        ...storedProfile,
        languageCode: "en",
      });
      await listProjectAdMarketKeywords(scope);
      const keys = m.snapshotFindUnique.mock.calls.map(
        ([args]) => args.where.projectId_kind_requestKey.requestKey,
      );
      expect(keys[0]).not.toBe(keys[1]);
    });

    it("ignores keyword order and case in the cache key", async () => {
      m.snapshotFindUnique.mockResolvedValue(null);
      m.profileFindUnique.mockResolvedValue({
        ...storedProfile,
        keywords: ["TRAIL", "running shoes"],
      });
      await listProjectAdMarketKeywords(scope);
      expect(
        m.snapshotFindUnique.mock.calls[0]?.[0].where.projectId_kind_requestKey
          .requestKey,
      ).toBe(KEY);
    });

    it("does not store anything when DataForSEO fails", async () => {
      m.snapshotFindUnique.mockResolvedValue(null);
      m.fetchMarketKeywords.mockRejectedValue(new Error("boom"));
      await expect(listProjectAdMarketKeywords(scope)).rejects.toThrow("boom");
      expect(m.snapshotUpsert).not.toHaveBeenCalled();
    });

    it("does not touch the profile or provider for a foreign Project", async () => {
      m.requireScopedProject.mockRejectedValue(notFound("Project not found"));
      await expect(listProjectAdMarketKeywords(scope)).rejects.toMatchObject({
        status: 404,
      });
      expect(m.profileFindUnique).not.toHaveBeenCalled();
      expect(m.fetchMarketKeywords).not.toHaveBeenCalled();
    });
  });
});
