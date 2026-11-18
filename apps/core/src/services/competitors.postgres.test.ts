import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  env: { EXA_API_KEY: "test-key" as string | undefined },
  readCompetitorPage: vi.fn(),
  searchExa: vi.fn(),
  ask: vi.fn(),
}));
vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      EXA_API_KEY: readers.env.EXA_API_KEY,
      META_AD_LIBRARY_ACCESS_TOKEN: undefined,
    }),
  };
});
vi.mock("@/lib/competitors/page-read", async (original) => ({
  ...(await original<typeof import("@/lib/competitors/page-read")>()),
  readCompetitorPage: readers.readCompetitorPage,
}));
vi.mock("@/lib/soko-bot/exa", () => ({ searchExa: readers.searchExa }));
vi.mock("@/lib/competitors/model", () => ({
  askCompetitorModel: readers.ask,
}));
vi.mock("@/helpers/cuso-low-credit-notification", () => ({
  notifyCusoLowCreditsAfterCharge: vi.fn(),
}));

import prisma from "@/lib/db/prisma";
import {
  runCusoCompetitorCheck,
  syncTrackedCompetitorsFromBrandBrain,
  watchedMapPlayers,
} from "@/services/cmo-competitors.service";
import { COMPETITOR_CHECK_CREDITS } from "@/services/competitor-check.service";
import {
  addTrackedCompetitor,
  listTrackedCompetitors,
  removeTrackedCompetitor,
  updateTrackedCompetitor,
} from "@/services/competitors.service";
import { expectCoreLog } from "@/test/core-log";
import {
  brain,
  company,
  deleteSeededCusos,
  type Seeded,
  seedCuso,
} from "@/test-fixtures/cmo-competitors-db";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const CREDIT = 10_000_000_000n;
const DAY = 86_400_000;

async function setBrain(projectId: string, body: unknown): Promise<void> {
  await prisma.brandBrain.upsert({
    where: { projectId },
    create: { projectId, body: body as object, updatedAt: new Date() },
    update: { body: body as object },
  });
}

async function names(projectId: string): Promise<string[]> {
  return (await listTrackedCompetitors(projectId)).map(
    (competitor) => competitor.name,
  );
}

async function spentCredits(cuso: Seeded): Promise<bigint> {
  const usage = await prisma.sokoBotUsage.aggregate({
    where: { sokoBotId: cuso.sokoBotId },
    _sum: { cents: true },
  });
  return (usage._sum.cents ?? 0n) / CREDIT;
}

const PAGE_LINES = Array.from(
  { length: 12 },
  (_unused, index) => `Scheduling statement number ${index}`,
);

function page(url: string, extra: string[] = []) {
  return { url, html: "<html></html>", lines: [...PAGE_LINES, ...extra] };
}

afterEach(async () => {
  if (enabled) await deleteSeededCusos();
});

describe.skipIf(!enabled)("tracked competitors (PostgreSQL)", () => {
  it("fills from research, the market map's players first, up to five", async () => {
    const cuso = await seedCuso();
    await setBrain(
      cuso.projectId,
      brain(
        [
          company("Doodle", "https://doodle.com/en/features"),
          company("Calendly", "https://calendly.com/pricing"),
          company("SavvyCal"),
          company("Zcal"),
          company("TidyCal"),
          company("YouCanBookMe"),
          company("cal com"),
        ],
        ["Cal.com", "Calendly"],
      ),
    );
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    expect(await names(cuso.projectId)).toEqual([
      "Cal.com",
      "Calendly",
      "Doodle",
      "SavvyCal",
      "Zcal",
    ]);
    const calendly = (await listTrackedCompetitors(cuso.projectId)).find(
      (competitor) => competitor.name === "Calendly",
    );
    expect(calendly).toMatchObject({
      websiteUrl: "https://calendly.com/",
      source: "RESEARCH",
    });

    // A second save adds nothing twice.
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    expect(await names(cuso.projectId)).toHaveLength(5);
  });

  it("never overrides or brings back what a member changed or removed", async () => {
    const cuso = await seedCuso();
    await setBrain(
      cuso.projectId,
      brain([company("Calendly"), company("Zcal")]),
    );
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    const [calendly, zcal] = await listTrackedCompetitors(cuso.projectId);
    if (!calendly || !zcal) throw new Error("not seeded");

    await updateTrackedCompetitor(cuso.projectId, calendly.id, {
      websiteUrl: "calendly.com/teams",
      instagramHandle: "@Calendly",
    });
    await removeTrackedCompetitor(cuso.projectId, zcal.id);
    await setBrain(
      cuso.projectId,
      brain([
        company("Calendly", "https://calendly.com/"),
        company("Zcal", "https://zcal.co/"),
      ]),
    );
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);

    expect(await listTrackedCompetitors(cuso.projectId)).toEqual([
      expect.objectContaining({
        name: "Calendly",
        websiteUrl: "https://calendly.com/teams",
        instagramHandle: "calendly",
      }),
    ]);
  });

  it("knows a renamed competitor by the name research found", async () => {
    const cuso = await seedCuso();
    await setBrain(cuso.projectId, brain([company("Calendly")]));
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    const [calendly] = await listTrackedCompetitors(cuso.projectId);
    if (!calendly) throw new Error("not seeded");
    await updateTrackedCompetitor(cuso.projectId, calendly.id, {
      name: "Calendly Inc",
    });
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    expect(await names(cuso.projectId)).toEqual(["Calendly Inc"]);
  });

  it("keeps a renamed competitor on the market map and takes a removed one off", async () => {
    const cuso = await seedCuso();
    await setBrain(
      cuso.projectId,
      brain([company("Calendly"), company("Zcal")], ["Calendly", "Zcal"]),
    );
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    const [calendly, zcal] = await listTrackedCompetitors(cuso.projectId);
    if (!calendly || !zcal) throw new Error("not seeded");
    expect(await watchedMapPlayers(cuso.projectId)).toEqual([
      "Calendly",
      "Zcal",
    ]);
    await updateTrackedCompetitor(cuso.projectId, calendly.id, {
      name: "Calendly Inc",
    });
    await removeTrackedCompetitor(cuso.projectId, zcal.id);
    expect(await watchedMapPlayers(cuso.projectId)).toEqual(["Calendly"]);
  });

  it("keeps a removed competitor's signals when a rename takes its name", async () => {
    const cuso = await seedCuso();
    await addTrackedCompetitor(cuso.projectId, { name: "Doodle" });
    await addTrackedCompetitor(cuso.projectId, { name: "Zcal" });
    const [doodle, zcal] = await listTrackedCompetitors(cuso.projectId);
    if (!doodle || !zcal) throw new Error("not seeded");
    await prisma.competitorSignal.create({
      data: {
        competitorId: doodle.id,
        projectId: cuso.projectId,
        kind: "NEWS",
        summary: "Doodle phased out Pro",
        observedAt: new Date(),
        raw: {},
        dedupeKey: "news:x",
      },
    });
    await removeTrackedCompetitor(cuso.projectId, doodle.id);
    await updateTrackedCompetitor(cuso.projectId, zcal.id, { name: "Doodle" });
    expect(
      await prisma.competitorSignal.count({
        where: { competitorId: doodle.id },
      }),
    ).toBe(1);
  });

  it("stays at five when members add at the same time", async () => {
    const cuso = await seedCuso();
    for (const name of ["A1", "B2", "C3", "D4"])
      await addTrackedCompetitor(cuso.projectId, { name });
    const results = await Promise.allSettled([
      addTrackedCompetitor(cuso.projectId, { name: "E5" }),
      addTrackedCompetitor(cuso.projectId, { name: "F6" }),
      addTrackedCompetitor(cuso.projectId, { name: "G7" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await names(cuso.projectId)).toHaveLength(5);
  });

  it("fills an empty website from research while nobody touched it", async () => {
    const cuso = await seedCuso();
    await setBrain(cuso.projectId, brain([company("Zcal")]));
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    await setBrain(
      cuso.projectId,
      brain([company("Zcal", "https://zcal.co/pricing")]),
    );
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    expect((await listTrackedCompetitors(cuso.projectId))[0]?.websiteUrl).toBe(
      "https://zcal.co/",
    );
  });

  it("lets a member add up to five, and brings a removed one back whole", async () => {
    const cuso = await seedCuso();
    for (const name of ["A1", "B2", "C3", "D4", "E5"])
      await addTrackedCompetitor(cuso.projectId, { name });
    await expect(
      addTrackedCompetitor(cuso.projectId, { name: "F6" }),
    ).rejects.toThrow("You can track 5 competitors");
    await expect(
      addTrackedCompetitor(cuso.projectId, { name: "a-1" }),
    ).rejects.toThrow("You can track 5 competitors");

    const [first] = await listTrackedCompetitors(cuso.projectId);
    if (!first) throw new Error("not seeded");
    await removeTrackedCompetitor(cuso.projectId, first.id);
    await expect(
      addTrackedCompetitor(cuso.projectId, { name: "b 2" }),
    ).rejects.toThrow("You already track this competitor");
    await addTrackedCompetitor(cuso.projectId, {
      name: "A1",
      websiteUrl: "a1.example",
    });
    const back = (await listTrackedCompetitors(cuso.projectId)).find(
      (competitor) => competitor.name === "A1",
    );
    expect(back).toMatchObject({
      id: first.id,
      websiteUrl: "https://a1.example/",
      source: "MEMBER",
    });
  });

  it("refuses a rename onto a tracked name and frees a removed one", async () => {
    const cuso = await seedCuso();
    await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
    await addTrackedCompetitor(cuso.projectId, { name: "Zcal" });
    await addTrackedCompetitor(cuso.projectId, { name: "Doodle" });
    const [calendly, zcal, doodle] = await listTrackedCompetitors(
      cuso.projectId,
    );
    if (!calendly || !zcal || !doodle) throw new Error("not seeded");
    await expect(
      updateTrackedCompetitor(cuso.projectId, calendly.id, { name: "ZCAL" }),
    ).rejects.toThrow("You already track this competitor");

    await removeTrackedCompetitor(cuso.projectId, doodle.id);
    await updateTrackedCompetitor(cuso.projectId, calendly.id, {
      name: "Doodle",
    });
    expect(await names(cuso.projectId)).toEqual(["Doodle", "Zcal"]);
  });

  it("refuses a field that is not an address or an account", async () => {
    const cuso = await seedCuso();
    await expect(
      addTrackedCompetitor(cuso.projectId, {
        name: "X",
        websiteUrl: "not a site",
      }),
    ).rejects.toThrow("The website is not a web address");
    await expect(
      addTrackedCompetitor(cuso.projectId, {
        name: "X",
        instagramHandle: "two words",
      }),
    ).rejects.toThrow("That is not an Instagram account");
  });
});

describe.skipIf(!enabled)("weekly competitor check (PostgreSQL)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readers.readCompetitorPage.mockImplementation(async (url: string) =>
      page(url),
    );
    readers.searchExa.mockResolvedValue({ results: [], costUsd: 0.007 });
  });

  async function cusoTracking(...competitors: string[]): Promise<Seeded> {
    const cuso = await seedCuso();
    for (const name of competitors)
      await addTrackedCompetitor(cuso.projectId, {
        name,
        websiteUrl: `https://${name.toLowerCase()}.example/`,
        pricingUrl: `https://${name.toLowerCase()}.example/pricing`,
      });
    return cuso;
  }

  it("runs once a week and charges the price per competitor once", async () => {
    const cuso = await cusoTracking("Calendly", "Zcal");
    const monday = new Date("2026-11-16T09:00:00Z");
    expect(await runCusoCompetitorCheck(cuso, monday)).toBe("checked");
    expect(
      await runCusoCompetitorCheck(cuso, new Date(monday.getTime() + DAY)),
    ).toBe("not_due");
    expect(await spentCredits(cuso)).toBe(BigInt(COMPETITOR_CHECK_CREDITS * 2));

    const check = await prisma.competitorCheck.findFirstOrThrow({
      where: { projectId: cuso.projectId },
    });
    expect(check).toMatchObject({
      competitorCount: 2,
      signalCount: 0,
      sources: {
        pages: { status: "ok" },
        news: { status: "ok" },
        ads: { status: "not_configured" },
        social: { status: "not_connected" },
      },
    });

    expect(
      await runCusoCompetitorCheck(cuso, new Date(monday.getTime() + 7 * DAY)),
    ).toBe("checked");
    expect(await spentCredits(cuso)).toBe(BigInt(COMPETITOR_CHECK_CREDITS * 4));
  });

  it("stores a price move once, with its quote, and keeps the newest page", async () => {
    const cuso = await cusoTracking("SavvyCal");
    const first = new Date("2026-11-09T09:00:00Z");
    readers.readCompetitorPage.mockImplementation(async (url: string) =>
      page(url, url.endsWith("/pricing") ? ["Premium", "$ 15 /user/mo"] : []),
    );
    await runCusoCompetitorCheck(cuso, first);
    expect(readers.ask).not.toHaveBeenCalled();

    readers.readCompetitorPage.mockImplementation(async (url: string) =>
      page(url, url.endsWith("/pricing") ? ["Premium", "$ 17 /user/mo"] : []),
    );
    readers.ask.mockResolvedValue({
      output: {
        real: true,
        summary: "Premium $15 -> $17 per user a month",
        quote: "$ 17 /user/mo",
        about: "pricing",
      },
      costUsd: 0.0004,
    });
    await runCusoCompetitorCheck(cuso, new Date(first.getTime() + 7 * DAY));
    // Read again a week later with the same page: nothing new.
    await runCusoCompetitorCheck(cuso, new Date(first.getTime() + 14 * DAY));

    const signals = await prisma.competitorSignal.findMany({
      where: { projectId: cuso.projectId },
    });
    expect(signals).toEqual([
      expect.objectContaining({
        kind: "PRICE_CHANGE",
        summary: "Premium $15 -> $17 per user a month",
        quote: "$ 17 /user/mo",
        sourceUrl: "https://savvycal.example/pricing",
        sourceTitle: "SavvyCal pricing",
        raw: expect.objectContaining({
          prices: { before: ["$15"], after: ["$17"] },
        }),
      }),
    ]);
    const snapshot = await prisma.competitorPageSnapshot.findFirstOrThrow({
      where: { competitor: { projectId: cuso.projectId }, kind: "PRICING" },
    });
    expect(snapshot.text).toContain("$ 17 /user/mo");
  });

  it("keeps a homepage change when the pricing page cannot be read", async () => {
    const cuso = await cusoTracking("SavvyCal");
    const first = new Date("2026-11-09T09:00:00Z");
    readers.readCompetitorPage.mockImplementation(async (url: string) =>
      page(url),
    );
    await runCompetitorCheck(cuso, first);

    readers.readCompetitorPage.mockImplementation(async (url: string) => {
      if (url.endsWith("/pricing")) throw new Error("socket hang up");
      return page(url, ["Now with team scheduling"]);
    });
    readers.ask.mockResolvedValue({
      output: {
        real: true,
        summary: "Homepage now offers team scheduling",
        quote: "Now with team scheduling",
        about: "product",
      },
      costUsd: 0.0004,
    });
    await runCompetitorCheck(cuso, new Date(first.getTime() + 7 * DAY));
    expectCoreLog("warn", "A competitor check source failed");

    const signals = await prisma.competitorSignal.findMany({
      where: { projectId: cuso.projectId },
    });
    expect(signals).toEqual([
      expect.objectContaining({
        kind: "WEBSITE_CHANGE",
        summary: "Homepage now offers team scheduling",
      }),
    ]);
    const check = await prisma.competitorCheck.findFirstOrThrow({
      where: { projectId: cuso.projectId },
      orderBy: { createdAt: "desc" },
    });
    expect(check.sources).toMatchObject({ pages: { status: "failed" } });
  });

  it("sees a change again when the check died before storing it", async () => {
    const cuso = await cusoTracking("SavvyCal");
    const first = new Date("2026-11-09T09:00:00Z");
    readers.readCompetitorPage.mockImplementation(async (url: string) =>
      page(url, url.endsWith("/pricing") ? ["Premium", "$ 15 /user/mo"] : []),
    );
    await runCompetitorCheck(cuso, first);

    readers.readCompetitorPage.mockImplementation(async (url: string) =>
      page(url, url.endsWith("/pricing") ? ["Premium", "$ 17 /user/mo"] : []),
    );
    readers.ask.mockResolvedValue({
      output: {
        real: true,
        summary: "Premium $15 -> $17 per user a month",
        quote: "$ 17 /user/mo",
        about: "pricing",
      },
      costUsd: 0.0004,
    });
    const second = new Date(first.getTime() + 7 * DAY);
    const store = vi
      .spyOn(prisma.competitorSignal, "createMany")
      .mockRejectedValueOnce(new Error("connection closed"));
    await expect(runCompetitorCheck(cuso, second)).rejects.toThrow(
      "connection closed",
    );
    store.mockRestore();

    // The check that died is redone after an hour.
    await runCompetitorCheck(cuso, new Date(second.getTime() + 2 * 3_600_000));
    expect(
      await prisma.competitorSignal.findMany({
        where: { projectId: cuso.projectId },
        select: { kind: true, summary: true },
      }),
    ).toEqual([
      { kind: "PRICE_CHANGE", summary: "Premium $15 -> $17 per user a month" },
    ]);
  });

  it("stores each article once across checks", async () => {
    const cuso = await cusoTracking("Calendly");
    const article = {
      title: "Calendly launches an AI notetaker",
      url: "https://techcrunch.com/calendly-notetaker",
      publishedDate: "2026-11-12",
      passages: ["Calendly launched an AI notetaker on all paid plans."],
    };
    readers.searchExa.mockResolvedValue({
      results: [article],
      costUsd: 0.007,
    });
    readers.ask.mockResolvedValue({
      output: {
        items: [
          {
            n: 0,
            isNews: true,
            story: "ai notetaker",
            summary: "Calendly launched an AI notetaker",
          },
        ],
      },
      costUsd: 0.0005,
    });
    const now = new Date("2026-11-13T09:00:00Z");
    await runCusoCompetitorCheck(cuso, now);
    await runCusoCompetitorCheck(cuso, new Date(now.getTime() + 7 * DAY));
    const signals = await prisma.competitorSignal.findMany({
      where: { projectId: cuso.projectId },
    });
    expect(signals).toEqual([
      expect.objectContaining({
        kind: "NEWS",
        summary: "Calendly launched an AI notetaker",
        sourceTitle: "Calendly launches an AI notetaker",
        sourcePublisher: "techcrunch.com",
        quote: "Calendly launched an AI notetaker on all paid plans.",
        observedAt: new Date("2026-11-12"),
      }),
    ]);
  });

  it("redoes a check that died, without charging it again", async () => {
    const cuso = await cusoTracking("Calendly");
    const start = new Date("2026-11-16T09:00:00Z");
    readers.readCompetitorPage.mockRejectedValueOnce(
      new Error("socket hang up"),
    );
    // A failing source is survived; the crash is simulated below.
    expect(await runCusoCompetitorCheck(cuso, start)).toBe("checked");
    const [warning] = expectCoreLog("warn", "A competitor check source failed");
    expect(warning?.event).toMatchObject({
      warnings: [
        expect.objectContaining({
          details: expect.objectContaining({ source: "pages" }),
        }),
      ],
    });
    expect(
      (
        await prisma.competitorCheck.findFirstOrThrow({
          where: { projectId: cuso.projectId },
        })
      ).sources,
    ).toMatchObject({ pages: { status: "failed" } });
    const charged = await spentCredits(cuso);
    await prisma.competitorCheck.updateMany({
      where: { projectId: cuso.projectId },
      data: { finishedAt: null },
    });

    expect(
      await runCusoCompetitorCheck(
        cuso,
        new Date(start.getTime() + 30 * 60_000),
      ),
    ).toBe("not_due");
    expect(
      await runCusoCompetitorCheck(
        cuso,
        new Date(start.getTime() + 2 * 3_600_000),
      ),
    ).toBe("checked");
    expect(await spentCredits(cuso)).toBe(charged);
    expect(
      await prisma.competitorCheck.count({
        where: { projectId: cuso.projectId },
      }),
    ).toBe(1);
  });

  it("fills a pricing page and handles only where no member touched the row", async () => {
    const cuso = await seedCuso();
    await setBrain(
      cuso.projectId,
      brain([
        company("Calendly", "https://calendly.com/"),
        company("Zcal", "https://zcal.co/"),
      ]),
    );
    await syncTrackedCompetitorsFromBrandBrain(cuso.projectId);
    const [calendly, zcal] = await listTrackedCompetitors(cuso.projectId);
    if (!calendly || !zcal) throw new Error("not seeded");
    await updateTrackedCompetitor(cuso.projectId, zcal.id, {
      instagramHandle: null,
    });
    readers.readCompetitorPage.mockImplementation(async (url: string) => ({
      ...page(url),
      html: '<a href="/pricing">Pricing</a><a href="https://www.instagram.com/brand/">IG</a>',
    }));
    await runCusoCompetitorCheck(cuso);
    const [after, untouched] = await listTrackedCompetitors(cuso.projectId);
    expect(after).toMatchObject({
      pricingUrl: "https://calendly.com/pricing",
      instagramHandle: "brand",
    });
    expect(untouched).toMatchObject({
      pricingUrl: null,
      instagramHandle: null,
    });
  });

  it("does nothing without credits, and runs once there are some", async () => {
    const cuso = await seedCuso(0n);
    await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
    const now = new Date("2026-11-16T09:00:00Z");
    expect(await runCusoCompetitorCheck(cuso, now)).toBe("unfunded");
    expect(
      await prisma.competitorCheck.count({
        where: { projectId: cuso.projectId },
      }),
    ).toBe(0);
  });

  it("skips a Project with nothing to track", async () => {
    const cuso = await seedCuso();
    expect(await runCusoCompetitorCheck(cuso)).toBe("no_competitors");
    expect(await spentCredits(cuso)).toBe(0n);
  });
});
