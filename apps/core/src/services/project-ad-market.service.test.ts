import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { notFound } from "@/helpers/error";
import type { MarketAd, MarketKeyword } from "@/lib/ads/dataforseo";

const m = vi.hoisted(() => {
  const fns = {
    requireScopedProject: vi.fn(),
    requireLockedOpenProject: vi.fn(),
    fetchMarketKeywords: vi.fn(),
    postSerpTasks: vi.fn(),
    postAdsSearchTasks: vi.fn(),
    getTaskResult: vi.fn(),
    profileFindUnique: vi.fn(),
    profileUpsert: vi.fn(),
    snapshotFindUnique: vi.fn(),
    snapshotUpsert: vi.fn(),
    snapshotDeleteMany: vi.fn(),
    jobFindUnique: vi.fn(),
    jobCreateMany: vi.fn(),
    jobUpdateMany: vi.fn(),
    jobUpdate: vi.fn(),
    jobDeleteMany: vi.fn(),
  };
  return {
    ...fns,
    tx: {
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      projectAdMarketProfile: {
        findUnique: fns.profileFindUnique,
        upsert: fns.profileUpsert,
      },
      projectAdMarketSnapshot: {
        findUnique: fns.snapshotFindUnique,
        upsert: fns.snapshotUpsert,
        deleteMany: fns.snapshotDeleteMany,
      },
      projectAdMarketAdsJob: {
        findUnique: fns.jobFindUnique,
        createMany: fns.jobCreateMany,
        updateMany: fns.jobUpdateMany,
        update: fns.jobUpdate,
        deleteMany: fns.jobDeleteMany,
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
  postSerpTasks: m.postSerpTasks,
  postAdsSearchTasks: m.postAdsSearchTasks,
  getTaskResult: m.getTaskResult,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (client: typeof m.tx) => unknown) => run(m.tx),
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.tx }));

import {
  getProjectAdMarketProfile,
  listProjectAdMarketAds,
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

const marketAd: MarketAd = {
  creativeId: "CR1",
  advertiserId: "AR1",
  advertiserName: "Acme Shoes",
  format: "image",
  previewImage: {
    url: "https://tpc.googlesyndication.com/archive/simgad/1",
    width: 300,
    height: 250,
  },
  previewUrl: "https://adstransparency.google.com/advertiser/AR1/creative/CR1",
  firstShown: "2026-09-01T08:00:00.000Z",
  lastShown: "2026-09-30T10:30:00.000Z",
  verified: true,
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
    m.jobFindUnique.mockResolvedValue(null);
    m.jobCreateMany.mockResolvedValue({ count: 1 });
    m.jobUpdateMany.mockResolvedValue({ count: 1 });
    m.jobUpdate.mockResolvedValue({});
    m.jobDeleteMany.mockResolvedValue({ count: 1 });
    m.postSerpTasks.mockResolvedValue(["s1", "s2"]);
    m.postAdsSearchTasks.mockResolvedValue(["a1", "a2"]);
    m.snapshotDeleteMany.mockResolvedValue({ count: 0 });
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

    it.each([
      ["country", { locationCode: 1 }],
      ["language", { languageCode: "xx" }],
    ])(
      "fails loudly on a stored %s outside the supported set",
      async (_n, override) => {
        m.profileFindUnique.mockResolvedValue({
          ...storedProfile,
          ...override,
        });
        await expect(getProjectAdMarketProfile(scope)).rejects.toMatchObject({
          status: 500,
        });
      },
    );

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
        { closedMessage: "Cannot change a closing or closed Project" },
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
      expect(m.fetchMarketKeywords).toHaveBeenCalledWith(
        expect.objectContaining({
          keywords: ["Running Shoes", "trail"],
          locationCode: 2276,
          languageCode: "de",
        }),
      );
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
        fetchedAt: NOW,
      });
    });

    it("replaces the Project's other keyword snapshots with the current one", async () => {
      m.snapshotFindUnique.mockResolvedValue(null);
      await listProjectAdMarketKeywords(scope);
      expect(m.snapshotDeleteMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT_ID,
          kind: "keywords",
          NOT: { requestKey: KEY },
        },
      });
    });

    it("serves a fresh snapshot without calling DataForSEO", async () => {
      const fetchedAt = new Date(NOW.getTime() - 23 * HOUR);
      m.snapshotFindUnique.mockResolvedValue({ payload: [keyword], fetchedAt });
      expect(await listProjectAdMarketKeywords(scope)).toEqual({
        keywords: [keyword],
        fetchedAt,
      });
      expect(m.fetchMarketKeywords).not.toHaveBeenCalled();
      expect(m.snapshotUpsert).not.toHaveBeenCalled();
      expect(m.snapshotDeleteMany).not.toHaveBeenCalled();
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

  describe("ads", () => {
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const job = (overrides: Record<string, unknown> = {}) => ({
      projectId: PROJECT_ID,
      requestKey: KEY,
      stage: "SERP",
      pendingTaskIds: ["s1", "s2"],
      collected: [],
      startedAt: ago(2 * MINUTE),
      checkedAt: ago(MINUTE),
      ...overrides,
    });
    const organicItem = (domain: string, rank: number) => ({
      type: "organic",
      domain,
      rank_group: rank,
    });
    const adItem = (creativeId: string, lastShown: string) => ({
      creative_id: creativeId,
      advertiser_id: "AR1",
      title: "Acme Shoes",
      format: "text",
      last_shown: lastShown,
    });
    const done = (...items: unknown[]) => ({ state: "done", items });
    const pending = { state: "pending" };
    const failed = { state: "failed" };
    /** Answers getTaskResult by task id. */
    function mockTasks(byId: Record<string, unknown>) {
      m.getTaskResult.mockImplementation(async (_kind: string, id: string) => {
        return byId[id];
      });
    }
    const staleSnapshot = {
      payload: [marketAd],
      fetchedAt: ago(25 * HOUR),
    };

    it("is 404 without a profile and never calls DataForSEO", async () => {
      m.profileFindUnique.mockResolvedValue(null);
      await expect(listProjectAdMarketAds(scope)).rejects.toMatchObject({
        status: 404,
      });
      expect(m.postSerpTasks).not.toHaveBeenCalled();
      expect(m.jobFindUnique).not.toHaveBeenCalled();
    });

    it("serves a fresh snapshot as ready without touching the job or DataForSEO", async () => {
      const fetchedAt = ago(HOUR);
      m.snapshotFindUnique.mockResolvedValue({
        payload: [marketAd],
        fetchedAt,
      });
      expect(await listProjectAdMarketAds(scope)).toEqual({
        status: "ready",
        ads: [marketAd],
        fetchedAt,
      });
      expect(m.snapshotFindUnique).toHaveBeenCalledWith({
        where: {
          projectId_kind_requestKey: {
            projectId: PROJECT_ID,
            kind: "ads",
            requestKey: KEY,
          },
        },
      });
      expect(m.jobFindUnique).not.toHaveBeenCalled();
      expect(m.postSerpTasks).not.toHaveBeenCalled();
    });

    describe("starting a job", () => {
      it("claims the row, then queues the SERP tasks of all keywords", async () => {
        m.snapshotFindUnique.mockResolvedValue(null);
        expect(await listProjectAdMarketAds(scope)).toEqual({
          status: "gathering",
          ads: [],
          fetchedAt: null,
        });
        expect(m.jobCreateMany).toHaveBeenCalledWith({
          data: {
            projectId: PROJECT_ID,
            requestKey: KEY,
            stage: "SERP",
            pendingTaskIds: [],
            collected: [],
            startedAt: NOW,
            checkedAt: NOW,
          },
          skipDuplicates: true,
        });
        expect(m.postSerpTasks).toHaveBeenCalledWith(
          expect.objectContaining({
            keywords: ["Running Shoes", "trail"],
            locationCode: 2276,
            languageCode: "de",
          }),
        );
        expect(m.jobUpdate).toHaveBeenCalledWith({
          where: { projectId: PROJECT_ID },
          data: { pendingTaskIds: ["s1", "s2"] },
        });
        expect(m.jobCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
          m.postSerpTasks.mock.invocationCallOrder[0] ?? 0,
        );
      });

      it("returns the stale snapshot's ads while the new job gathers", async () => {
        m.snapshotFindUnique.mockResolvedValue(staleSnapshot);
        expect(await listProjectAdMarketAds(scope)).toEqual({
          status: "gathering",
          ads: [marketAd],
          fetchedAt: staleSnapshot.fetchedAt,
        });
        expect(m.postSerpTasks).toHaveBeenCalledTimes(1);
      });

      it("does not post when another request created the job first", async () => {
        m.snapshotFindUnique.mockResolvedValue(null);
        m.jobCreateMany.mockResolvedValue({ count: 0 });
        expect((await listProjectAdMarketAds(scope)).status).toBe("gathering");
        expect(m.postSerpTasks).not.toHaveBeenCalled();
      });

      it("releases the claim, so the next poll starts again, when queueing fails", async () => {
        m.snapshotFindUnique.mockResolvedValue(null);
        m.postSerpTasks.mockRejectedValue(new Error("boom"));
        await expect(listProjectAdMarketAds(scope)).rejects.toThrow("boom");
        expect(m.jobDeleteMany).toHaveBeenCalledWith({
          where: { projectId: PROJECT_ID, requestKey: KEY },
        });
      });

      it("discards a job of another profile and starts a new one", async () => {
        m.snapshotFindUnique.mockResolvedValue(null);
        const old = job({ requestKey: "other", stage: "ADS" });
        m.jobFindUnique.mockResolvedValue(old);
        expect((await listProjectAdMarketAds(scope)).status).toBe("gathering");
        expect(m.jobUpdateMany).toHaveBeenCalledWith({
          where: { projectId: PROJECT_ID, checkedAt: old.checkedAt },
          data: expect.objectContaining({
            requestKey: KEY,
            stage: "SERP",
            pendingTaskIds: [],
            collected: [],
            startedAt: NOW,
          }),
        });
        expect(m.jobCreateMany).not.toHaveBeenCalled();
        expect(m.getTaskResult).not.toHaveBeenCalled();
        expect(m.postSerpTasks).toHaveBeenCalledTimes(1);
      });

      it("does not post when another request replaced the job first", async () => {
        m.snapshotFindUnique.mockResolvedValue(null);
        m.jobFindUnique.mockResolvedValue(job({ requestKey: "other" }));
        m.jobUpdateMany.mockResolvedValue({ count: 0 });
        expect((await listProjectAdMarketAds(scope)).status).toBe("gathering");
        expect(m.postSerpTasks).not.toHaveBeenCalled();
      });
    });

    describe("failed job", () => {
      it("is reported as failed, with the stale ads, for an hour without reposting", async () => {
        m.snapshotFindUnique.mockResolvedValue(staleSnapshot);
        m.jobFindUnique.mockResolvedValue(
          job({
            stage: "FAILED",
            pendingTaskIds: [],
            startedAt: ago(59 * MINUTE),
          }),
        );
        expect(await listProjectAdMarketAds(scope)).toEqual({
          status: "failed",
          ads: [marketAd],
          fetchedAt: staleSnapshot.fetchedAt,
        });
        expect(m.postSerpTasks).not.toHaveBeenCalled();
        expect(m.getTaskResult).not.toHaveBeenCalled();
        expect(m.jobUpdateMany).not.toHaveBeenCalled();
      });

      it("starts a new job after an hour", async () => {
        m.snapshotFindUnique.mockResolvedValue(null);
        m.jobFindUnique.mockResolvedValue(
          job({
            stage: "FAILED",
            pendingTaskIds: [],
            startedAt: ago(61 * MINUTE),
          }),
        );
        expect((await listProjectAdMarketAds(scope)).status).toBe("gathering");
        expect(m.postSerpTasks).toHaveBeenCalledTimes(1);
      });
    });

    describe("checking a job", () => {
      beforeEach(() => {
        m.snapshotFindUnique.mockResolvedValue(null);
      });

      it("does not ask DataForSEO within 20s of the last check", async () => {
        m.jobFindUnique.mockResolvedValue(job({ checkedAt: ago(19 * SECOND) }));
        expect(await listProjectAdMarketAds(scope)).toEqual({
          status: "gathering",
          ads: [],
          fetchedAt: null,
        });
        expect(m.jobUpdateMany).not.toHaveBeenCalled();
        expect(m.getTaskResult).not.toHaveBeenCalled();
      });

      it("claims the check on the checkedAt it saw", async () => {
        const seen = job({ checkedAt: ago(21 * SECOND) });
        m.jobFindUnique.mockResolvedValue(seen);
        mockTasks({ s1: pending, s2: pending });
        await listProjectAdMarketAds(scope);
        expect(m.jobUpdateMany).toHaveBeenCalledWith({
          where: { projectId: PROJECT_ID, checkedAt: seen.checkedAt },
          data: { checkedAt: NOW },
        });
      });

      it("leaves the check to the request that won the claim", async () => {
        m.jobFindUnique.mockResolvedValue(job());
        m.jobUpdateMany.mockResolvedValue({ count: 0 });
        expect((await listProjectAdMarketAds(scope)).status).toBe("gathering");
        expect(m.getTaskResult).not.toHaveBeenCalled();
        expect(m.postAdsSearchTasks).not.toHaveBeenCalled();
        expect(m.postSerpTasks).not.toHaveBeenCalled();
      });

      describe("SERP stage", () => {
        it("keeps what finished, as ranks per keyword, and waits for the rest", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({
            s1: done(organicItem("www.acme.com", 2), { type: "local_pack" }),
            s2: pending,
          });
          expect((await listProjectAdMarketAds(scope)).status).toBe(
            "gathering",
          );
          expect(m.getTaskResult).toHaveBeenCalledWith("organic", "s1");
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: {
              pendingTaskIds: ["s2"],
              collected: [[{ domain: "acme.com", rank: 2 }]],
            },
          });
          expect(m.postAdsSearchTasks).not.toHaveBeenCalled();
        });

        it("keeps the ranks of earlier checks", async () => {
          const earlier = [[{ domain: "acme.com", rank: 2 }]];
          m.jobFindUnique.mockResolvedValue(
            job({ pendingTaskIds: ["s2"], collected: earlier }),
          );
          mockTasks({ s2: pending });
          await listProjectAdMarketAds(scope);
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: { pendingTaskIds: ["s2"], collected: earlier },
          });
        });

        it("queues one ads task per competitor, strongest first, and moves to the ADS stage", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({
            s1: done(organicItem("solo.com", 1), organicItem("both.com", 5)),
            s2: done(
              organicItem("both.com", 2),
              organicItem("www.reddit.com", 1),
            ),
          });
          expect((await listProjectAdMarketAds(scope)).status).toBe(
            "gathering",
          );
          expect(m.postAdsSearchTasks).toHaveBeenCalledWith(
            ["both.com", "solo.com"],
            2276,
            NOW,
          );
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: {
              stage: "ADS",
              pendingTaskIds: ["a1", "a2"],
              collected: [],
              startedAt: NOW,
            },
          });
        });

        it("drops a failed task and goes on with the others", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({ s1: done(organicItem("acme.com", 1)), s2: failed });
          await listProjectAdMarketAds(scope);
          expect(m.postAdsSearchTasks).toHaveBeenCalledWith(
            ["acme.com"],
            2276,
            NOW,
          );
        });

        it("drops tasks still queued after 30 minutes and goes on with what finished", async () => {
          m.jobFindUnique.mockResolvedValue(
            job({
              startedAt: ago(31 * MINUTE),
              pendingTaskIds: ["s2"],
              collected: [[{ domain: "acme.com", rank: 1 }]],
            }),
          );
          mockTasks({ s2: pending });
          await listProjectAdMarketAds(scope);
          expect(m.postAdsSearchTasks).toHaveBeenCalledWith(
            ["acme.com"],
            2276,
            NOW,
          );
        });

        it("keeps waiting for queued tasks before 30 minutes", async () => {
          m.jobFindUnique.mockResolvedValue(
            job({ startedAt: ago(29 * MINUTE), pendingTaskIds: ["s2"] }),
          );
          mockTasks({ s2: pending });
          await listProjectAdMarketAds(scope);
          expect(m.postAdsSearchTasks).not.toHaveBeenCalled();
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: { pendingTaskIds: ["s2"], collected: [] },
          });
        });

        it("writes an empty snapshot and deletes the job when nobody ranks", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({ s1: done(), s2: done(organicItem("reddit.com", 1)) });
          expect(await listProjectAdMarketAds(scope)).toEqual({
            status: "ready",
            ads: [],
            fetchedAt: NOW,
          });
          expect(m.postAdsSearchTasks).not.toHaveBeenCalled();
          expect(m.snapshotUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
              create: expect.objectContaining({ kind: "ads", payload: [] }),
            }),
          );
          expect(m.jobDeleteMany).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
          });
        });

        it("fails the job when every SERP task failed, without queueing ads", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({ s1: failed, s2: failed });
          expect((await listProjectAdMarketAds(scope)).status).toBe("failed");
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: {
              stage: "FAILED",
              pendingTaskIds: [],
              collected: [],
              startedAt: NOW,
            },
          });
          expect(m.postAdsSearchTasks).not.toHaveBeenCalled();
          expect(m.snapshotUpsert).not.toHaveBeenCalled();
        });

        it("restarts a job whose stored ranks no longer parse", async () => {
          m.jobFindUnique.mockResolvedValue(job({ collected: [{ nope: 1 }] }));
          expect((await listProjectAdMarketAds(scope)).status).toBe(
            "gathering",
          );
          expect(m.getTaskResult).not.toHaveBeenCalled();
          expect(m.postSerpTasks).toHaveBeenCalledTimes(1);
        });

        it("leaves the job as it was when queueing the ads fails, so the next poll retries", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({ s1: done(organicItem("acme.com", 1)), s2: done() });
          m.postAdsSearchTasks.mockRejectedValue(new Error("boom"));
          await expect(listProjectAdMarketAds(scope)).rejects.toThrow("boom");
          expect(m.jobUpdate).not.toHaveBeenCalled();
        });
        it("fails the job when DataForSEO refuses every ads task, so polling does not retry", async () => {
          m.jobFindUnique.mockResolvedValue(job());
          mockTasks({ s1: done(organicItem("acme.com", 1)), s2: done() });
          m.postAdsSearchTasks.mockRejectedValue(
            new ComposioToolError({
              message: "DataForSEO refused the request",
              providerStatus: 40501,
            }),
          );
          expect((await listProjectAdMarketAds(scope)).status).toBe("failed");
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: expect.objectContaining({ stage: "FAILED" }),
          });
        });
      });

      describe("ADS stage", () => {
        const adsJob = (overrides: Record<string, unknown> = {}) =>
          job({ stage: "ADS", pendingTaskIds: ["a1", "a2"], ...overrides });

        it("keeps a competitor's 4 newest ads and waits for the rest", async () => {
          m.jobFindUnique.mockResolvedValue(adsJob());
          mockTasks({
            a1: done(
              ...[1, 2, 3, 4, 5].map((day) =>
                adItem(`D${day}`, `2026-09-0${day} 00:00:00 +00:00`),
              ),
            ),
            a2: pending,
          });
          expect((await listProjectAdMarketAds(scope)).status).toBe(
            "gathering",
          );
          expect(m.getTaskResult).toHaveBeenCalledWith("ads_search", "a1");
          const { data } = m.jobUpdate.mock.calls[0]?.[0] ?? {};
          expect(data.pendingTaskIds).toEqual(["a2"]);
          expect(
            data.collected[0].map((ad: MarketAd) => ad.creativeId),
          ).toEqual(["D5", "D4", "D3", "D2"]);
          expect(m.snapshotUpsert).not.toHaveBeenCalled();
        });

        it("writes the merged ads as the snapshot, drops other keys and deletes the job", async () => {
          m.jobFindUnique.mockResolvedValue(adsJob());
          mockTasks({
            a1: done(adItem("CR1", "2026-09-10 00:00:00 +00:00")),
            a2: done(
              adItem("CR1", "2026-09-20 00:00:00 +00:00"),
              adItem("CR2", "2026-09-15 00:00:00 +00:00"),
            ),
          });
          const result = await listProjectAdMarketAds(scope);
          expect(result.status).toBe("ready");
          expect(result.fetchedAt).toEqual(NOW);
          expect(result.ads.map((ad) => [ad.creativeId, ad.lastShown])).toEqual(
            [
              ["CR1", "2026-09-20T00:00:00.000Z"],
              ["CR2", "2026-09-15T00:00:00.000Z"],
            ],
          );
          expect(m.snapshotUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
              create: expect.objectContaining({
                projectId: PROJECT_ID,
                kind: "ads",
                requestKey: KEY,
                payload: result.ads,
                fetchedAt: NOW,
              }),
              update: { payload: result.ads, fetchedAt: NOW },
            }),
          );
          expect(m.snapshotDeleteMany).toHaveBeenCalledWith({
            where: {
              projectId: PROJECT_ID,
              kind: "ads",
              NOT: { requestKey: KEY },
            },
          });
          expect(m.jobDeleteMany).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
          });
        });

        it("adds the ads of earlier checks", async () => {
          m.jobFindUnique.mockResolvedValue(
            adsJob({ pendingTaskIds: ["a2"], collected: [[marketAd]] }),
          );
          mockTasks({ a2: done(adItem("CR2", "2026-09-15 00:00:00 +00:00")) });
          const { ads } = await listProjectAdMarketAds(scope);
          expect(ads.map((ad) => ad.creativeId)).toEqual(["CR1", "CR2"]);
        });

        it("is ready with no ads when competitors have none, not failed", async () => {
          m.jobFindUnique.mockResolvedValue(adsJob());
          mockTasks({ a1: done(), a2: done() });
          expect(await listProjectAdMarketAds(scope)).toEqual({
            status: "ready",
            ads: [],
            fetchedAt: NOW,
          });
        });

        it("fails the job, without reposting, when every ads task failed", async () => {
          m.jobFindUnique.mockResolvedValue(adsJob());
          mockTasks({ a1: failed, a2: failed });
          expect((await listProjectAdMarketAds(scope)).status).toBe("failed");
          expect(m.jobUpdate).toHaveBeenCalledWith({
            where: { projectId: PROJECT_ID },
            data: expect.objectContaining({ stage: "FAILED" }),
          });
          expect(m.postAdsSearchTasks).not.toHaveBeenCalled();
          expect(m.postSerpTasks).not.toHaveBeenCalled();
          expect(m.snapshotUpsert).not.toHaveBeenCalled();
        });

        it("drops ads tasks still queued after 30 minutes", async () => {
          m.jobFindUnique.mockResolvedValue(
            adsJob({
              startedAt: ago(31 * MINUTE),
              pendingTaskIds: ["a2"],
              collected: [[marketAd]],
            }),
          );
          mockTasks({ a2: pending });
          const result = await listProjectAdMarketAds(scope);
          expect(result).toMatchObject({ status: "ready", ads: [marketAd] });
        });

        it("returns the stale ads while it waits", async () => {
          m.snapshotFindUnique.mockResolvedValue(staleSnapshot);
          m.jobFindUnique.mockResolvedValue(adsJob());
          mockTasks({ a1: pending, a2: pending });
          expect(await listProjectAdMarketAds(scope)).toEqual({
            status: "gathering",
            ads: [marketAd],
            fetchedAt: staleSnapshot.fetchedAt,
          });
        });
      });
    });

    it("keys the snapshot on the profile: a language change finds a different one", async () => {
      m.snapshotFindUnique.mockResolvedValue(null);
      await listProjectAdMarketAds(scope);
      m.profileFindUnique.mockResolvedValue({
        ...storedProfile,
        languageCode: "en",
      });
      await listProjectAdMarketAds(scope);
      const keys = m.snapshotFindUnique.mock.calls.map(
        ([args]) => args.where.projectId_kind_requestKey.requestKey,
      );
      expect(keys[0]).toBe(KEY);
      expect(keys[1]).not.toBe(KEY);
    });
  });
});
