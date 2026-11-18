/**
 * Real-Postgres proof of the Competitors page's read: the scoreboard from the
 * stored Instagram readings (growth needs two readings a week apart), each
 * competitor's top posts, the business's own row from its synced account,
 * a removed competitor leaving with its moves, and what each source needs.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-competitors-overview.postgres.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      EXA_API_KEY: "test-key",
      META_AD_LIBRARY_ACCESS_TOKEN: undefined,
    }),
  };
});

import prisma from "@/lib/db/prisma";
import { getCmoCompetitors } from "@/services/cmo-competitors.service";
import {
  addTrackedCompetitor,
  listTrackedCompetitors,
  removeTrackedCompetitor,
} from "@/services/competitors.service";
import {
  deleteSeededCusos,
  type Seeded,
  seedCuso,
} from "@/test-fixtures/cmo-competitors-db";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const NOW = new Date("2026-11-16T10:00:00Z");
const DAY = 86_400_000;

function reading(followers: number, posts: number, topLikes: number) {
  return {
    network: "instagram",
    handle: "calendly",
    followers,
    postsThisWeek: posts,
    engagementPerPost: 120,
    topPosts: [
      {
        id: "p1",
        url: "https://www.instagram.com/p/p1/",
        caption: "Five scheduling habits",
        type: "FEED",
        postedAt: "2026-11-12T09:00:00.000Z",
        likes: topLikes,
        comments: 4,
      },
    ],
  };
}

async function social(
  cuso: Seeded,
  competitorId: string,
  daysAgo: number,
  raw: object,
) {
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  await prisma.competitorSignal.create({
    data: {
      projectId: cuso.projectId,
      competitorId,
      kind: "SOCIAL",
      summary: "Instagram week",
      observedAt: at,
      createdAt: at,
      sourceUrl: "https://www.instagram.com/calendly/",
      raw,
      dedupeKey: `instagram:${at.toISOString().slice(0, 10)}`,
    },
  });
}

afterEach(async () => {
  if (enabled) await deleteSeededCusos();
});

describe.skipIf(!enabled)(
  "Competitors page read (PostgreSQL)",
  { timeout: 20_000 },
  () => {
    it("builds the scoreboard from the stored readings, with source and date", async () => {
      const cuso = await seedCuso();
      await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
      await addTrackedCompetitor(cuso.projectId, { name: "Zcal" });
      const [calendly, zcal] = await listTrackedCompetitors(cuso.projectId);
      if (!calendly || !zcal) throw new Error("not seeded");
      await social(cuso, calendly.id, 7, reading(40_000, 5, 300));
      await social(cuso, calendly.id, 0, reading(41_200, 6, 900));

      const page = await getCmoCompetitors(cuso, NOW);
      expect(page.scoreboard.map((row) => row.name)).toEqual([
        "acme.io",
        "Calendly",
        "Zcal",
      ]);
      const observedAt = NOW;
      const sourceUrl = "https://www.instagram.com/calendly/";
      expect(page.scoreboard[1]).toEqual({
        competitorId: calendly.id,
        name: "Calendly",
        postsPerWeek: { value: 6, sourceUrl, observedAt },
        engagementPerPost: { value: 120, sourceUrl, observedAt },
        followers: { value: 41_200, sourceUrl, observedAt },
        followerGrowth: { value: 1_200, sourceUrl, observedAt },
      });
      // No reading, and no connected account for the business: empty cells.
      for (const row of [page.scoreboard[0], page.scoreboard[2]])
        expect(row).toMatchObject({
          postsPerWeek: null,
          engagementPerPost: null,
          followers: null,
          followerGrowth: null,
        });
      expect(page.topPosts).toEqual([
        expect.objectContaining({
          competitorId: calendly.id,
          caption: "Five scheduling habits",
          likes: 900,
        }),
      ]);
      // The reading itself is a signal a fact may cite.
      expect(page.signals.map((signal) => signal.kind)).toEqual([
        "SOCIAL",
        "SOCIAL",
      ]);
    });

    it("gives no growth from one reading", async () => {
      const cuso = await seedCuso();
      await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
      const [calendly] = await listTrackedCompetitors(cuso.projectId);
      if (!calendly) throw new Error("not seeded");
      await social(cuso, calendly.id, 0, reading(41_200, 6, 900));
      const page = await getCmoCompetitors(cuso, NOW);
      expect(page.scoreboard[1]?.followers?.value).toBe(41_200);
      expect(page.scoreboard[1]?.followerGrowth).toBeNull();
    });

    it("says what each source needs, and when the next check is", async () => {
      const cuso = await seedCuso();
      await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
      await prisma.competitorCheck.create({
        data: {
          projectId: cuso.projectId,
          day: "2026-11-16",
          createdAt: NOW,
          finishedAt: NOW,
          sources: {
            pages: { status: "failed" },
            news: { status: "ok" },
            ads: { status: "not_configured" },
            social: { status: "not_connected" },
          },
        },
      });
      const { check, feed, limit } = await getCmoCompetitors(cuso, NOW);
      expect(feed).toBeNull();
      expect(limit).toBe(5);
      expect(check.lastCheckedAt).toEqual(NOW);
      expect(check.nextCheckAt).toEqual(new Date(NOW.getTime() + 6.5 * DAY));
      expect(check.creditsPerCompetitor).toBe(3);
      expect(check.sources).toEqual({
        pages: { status: "failed", needs: null },
        news: { status: "ok", needs: null },
        ads: {
          status: "not_configured",
          needs: expect.stringContaining("Meta's Ad Library"),
        },
        social: {
          status: "not_connected",
          needs: expect.stringContaining("Connect your Instagram"),
        },
      });
    });

    it("drops a removed competitor with its signals and its moves", async () => {
      const cuso = await seedCuso();
      await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
      await addTrackedCompetitor(cuso.projectId, { name: "Zcal" });
      const [calendly, zcal] = await listTrackedCompetitors(cuso.projectId);
      if (!calendly || !zcal) throw new Error("not seeded");
      const item = (competitorId: string, id: string) => ({
        id,
        competitorId,
        facts: [
          {
            text: "It launched something.",
            signalIds: ["bbbbbbbb-bbbb-4bbb-8bbb-000000000001"],
            support: "weak",
          },
        ],
        meaning: "It matters a little.",
        move: "Post about it on Tuesday.",
        big: false,
      });
      await prisma.competitorFeed.create({
        data: {
          projectId: cuso.projectId,
          checkDay: "2026-11-16",
          items: [
            item(calendly.id, "cccccccc-cccc-4ccc-8ccc-000000000001"),
            item(zcal.id, "cccccccc-cccc-4ccc-8ccc-000000000002"),
          ],
        },
      });
      await social(cuso, zcal.id, 0, reading(3_400, 2, 50));
      await removeTrackedCompetitor(cuso.projectId, zcal.id);

      const page = await getCmoCompetitors(cuso, NOW);
      expect(page.mapPlayers).toEqual([]);
      expect(page.competitors.map((c) => c.name)).toEqual(["Calendly"]);
      expect(page.feed?.items.map((move) => move.competitorId)).toEqual([
        calendly.id,
      ]);
      expect(page.signals).toEqual([]);
      expect(page.topPosts).toEqual([]);
    });
  },
);
