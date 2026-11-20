/**
 * The CMO SEO tab against PostgreSQL, from a real weekly audit report
 * (battery-sensei.app, 2026-11-16):
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-seo.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { SEO_FULL_AUDIT_CREDITS } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import { fetchKeywordIdeas, fetchKeywordOverview } from "@/lib/ads/dataforseo";
import { askCmoEditor, EDITORS } from "./cmo-keyword-editorial";

vi.mock("./cmo-keyword-editorial", async (original) => ({
  ...(await original<typeof import("./cmo-keyword-editorial")>()),
  askCmoEditor: vi.fn(),
}));

import prisma from "@/lib/db/prisma";
import { parseSeoMonitorPlan } from "@/lib/seo/monitor-plan";
import { type Cuso, findCusoForBot } from "./cmo-cuso.service";
import {
  markCmoLandingPageLive,
  readCmoSeo,
  saveCmoSeoSuggestions,
  searchCmoKeywords,
  setCmoSeoSuggestionStatus,
} from "./cmo-seo.service";
import {
  keepCmoSeoAudit,
  listCmoSeoAuditRuns,
  pauseCmoSeoAuditsWithoutCuso,
  readCmoSeoAudit,
  verifyCmoSeoChanges,
} from "./cmo-seo-audit.service";
import {
  checkCmoSearchRankings,
  seoCheckOutcome,
} from "./cmo-seo-rankings.service";

vi.mock("@/lib/ads/dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/dataforseo")>()),
  fetchKeywordOverview: vi.fn(),
  fetchKeywordIdeas: vi.fn(async () => [
    {
      keyword: "macbook battery health app",
      searchVolume: 140,
      difficulty: 1,
      intent: "commercial",
      cpc: 0.4,
    },
    {
      keyword: "macbook charge limit",
      searchVolume: 110,
      difficulty: 12,
      intent: "commercial",
      cpc: null,
    },
  ]),
}));

// A landing page's quotes are read on the competitor's own page.
vi.mock("@/lib/competitors/page-read", () => ({
  readCompetitorPage: vi.fn(async (url: string) =>
    url === "https://apphousekitchen.com/pricing"
      ? {
          url,
          html: "",
          lines: ["AlDente Pro", "Yearly: 12 EUR a year", "Lifetime: 25 EUR"],
        }
      : null,
  ),
}));
// Jev backs every statement but one that calls the competitor slow.
vi.mock("@/lib/soko-bot/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot/jev")>()),
  evaluateWithJev: vi.fn(
    async (options: {
      state: { statements: { key: string; statement: string }[] };
    }) => ({
      costUsd: 0.001,
      answers: new Map(
        options.state.statements.map(({ key, statement }) => [
          key,
          {
            type: "boolean" as const,
            probability: /slow/.test(statement) ? 0.05 : 0.95,
          },
        ]),
      ),
    }),
  ),
}));

// "Run now" announces the first audit's Task over realtime.
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(async () => undefined),
}));
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const report = JSON.parse(
  readFileSync(
    new URL("../test-fixtures/cmo-seo-audit-report.json", import.meta.url),
    "utf8",
  ),
);
const CREDIT = 10n ** 10n;
const userId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID();
const env = getEnv();
const previous = {
  SEO_ANALYSIS_EXECUTOR: env.SEO_ANALYSIS_EXECUTOR,
  SEO_ANALYSIS_DISPATCH_ENABLED: env.SEO_ANALYSIS_DISPATCH_ENABLED,
};
let cuso: Cuso;

async function setCredits(credits: bigint) {
  await prisma.creditBucket.deleteMany({ where: { organizationId } });
  if (credits === 0n) return;
  const topUp = await prisma.transaction.create({
    data: { amount: credits * CREDIT, organizationId },
    select: { id: true },
  });
  await prisma.creditBucket.create({
    data: {
      amount: credits * CREDIT,
      organizationId,
      projectId,
      sourceTransactionId: topUp.id,
    },
  });
}

async function setSubscribed(subscribed: boolean) {
  await prisma.polarSubscription.deleteMany({ where: { projectId } });
  if (!subscribed) return;
  await prisma.polarSubscription.create({
    data: {
      kind: "CMO",
      projectId,
      organizationId,
      polarSubscriptionId: randomUUID(),
      polarProductId: "growth",
      tier: "growth",
      interval: "month",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      polarEventAt: new Date(),
    },
  });
}

const monitors = () =>
  prisma.taskSchedule.findMany({
    where: { projectId, description: { startsWith: "seo_monitor: " } },
    orderBy: { createdAt: "asc" },
  });

async function storeAudit(payload: unknown, observedAt: Date) {
  const pageIds = (
    await prisma.projectSeoPage.findMany({
      where: { projectId },
      select: { id: true },
    })
  ).map((page) => page.id);
  await prisma.projectSeoObservation.create({
    data: {
      projectId,
      kind: "audit_full",
      source: "seo_coworker",
      sourceKey: `test:${randomUUID()}`,
      pageIds,
      artifactHash: randomUUID(),
      payload: payload as object,
      observedAt,
    },
  });
}

describe.skipIf(!enabled)("CMO SEO against PostgreSQL", () => {
  beforeAll(async () => {
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
    env.SEO_ANALYSIS_EXECUTOR = {
      mode: "global",
      coworkerId,
      canUsePaidSearchData: true,
      canSchedule: true,
    };
    await prisma.user.create({
      data: {
        id: userId,
        name: "Ada Owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "battery-sensei.app",
        workspace: { create: { id: workspaceId } },
        members: {
          create: { userId, role: "owner", seatAssignedAt: new Date() },
        },
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        workspaceId,
        name: "Cuso",
        websiteUrl: "https://battery-sensei.app/",
      },
    });
    const bot = await prisma.sokoBot.create({
      data: {
        workspaceId,
        projectId,
        userId: null,
        createdByUserId: userId,
        versionId: CMO_SOKO_BOT_VERSION_ID,
        name: "Cuso",
      },
    });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "SEO vendor" },
    });
    await prisma.coworker.create({
      data: {
        id: coworkerId,
        slug: coworkerId,
        name: "SEO",
        vendorId,
        isWhitelisted: true,
        capabilities: ["tasks"],
      },
    });
    const found = await findCusoForBot(bot.id);
    if (!found) throw new Error("Cuso fixture missing");
    cuso = found;
  });

  afterAll(async () => {
    Object.assign(env, previous);
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await prisma.transaction.deleteMany({ where: { organizationId } });
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.coworker.deleteMany({ where: { id: coworkerId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("starts no audit for a test copy whose source was audited this week, and shows the copy that audit", async () => {
    const copyProject = await prisma.project.create({
      data: {
        workspaceId,
        name: "Cuso (test copy)",
        websiteUrl: "https://battery-sensei.app/",
        testCopyOfProjectId: projectId,
      },
      select: { id: true },
    });
    const copyBot = await prisma.sokoBot.create({
      data: {
        workspaceId,
        projectId: copyProject.id,
        userId: null,
        createdByUserId: userId,
        versionId: CMO_SOKO_BOT_VERSION_ID,
        name: "Cuso",
      },
    });
    const copy = await findCusoForBot(copyBot.id);
    if (!copy) throw new Error("Copy fixture missing");
    // The copy is paid for, with credits for an audit of its own.
    const grant = await prisma.transaction.create({
      data: { amount: 10_000n * CREDIT, organizationId },
      select: { id: true },
    });
    await prisma.creditBucket.create({
      data: {
        amount: 10_000n * CREDIT,
        organizationId,
        projectId: copyProject.id,
        sourceTransactionId: grant.id,
        referenceType: "CMO_TESTER_CREDITS",
      },
    });
    const copyMonitors = () =>
      prisma.taskSchedule.count({ where: { projectId: copyProject.id } });
    const sourceAudit = (createdAt: Date, status = "completed") =>
      prisma.projectSeoAnalysis.create({
        data: {
          projectId,
          kind: "audit_full",
          status,
          idempotencyKey: randomUUID(),
          requestHash: randomUUID(),
          request: {},
          requestedBy: userId,
          createdAt,
        },
        select: { id: true },
      });
    const days = (count: number) => new Date(Date.now() - count * 86_400_000);

    // Audited three days ago: the copy starts nothing.
    const recent = await sourceAudit(days(3));
    await keepCmoSeoAudit(copy);
    expect(await copyMonitors()).toBe(0);
    // And reads the source's report on its own SEO tab.
    await storeAudit(report, days(3));
    expect((await readCmoSeoAudit(copy)).latest?.checked).toBeGreaterThan(0);

    // Only an audit older than a week, or a failed one: the copy audits.
    await prisma.projectSeoAnalysis.update({
      where: { id: recent.id },
      data: { createdAt: days(8) },
    });
    await sourceAudit(days(1), "failed");
    await keepCmoSeoAudit(copy);
    expect(await copyMonitors()).toBe(1);

    await prisma.projectSeoObservation.deleteMany({ where: { projectId } });
    await prisma.projectSeoAnalysis.deleteMany({
      where: { projectId: { in: [projectId, copyProject.id] } },
    });
    await prisma.task.deleteMany({ where: { projectId: copyProject.id } });
    await prisma.taskSchedule.deleteMany({
      where: { projectId: copyProject.id },
    });
    await prisma.transaction.deleteMany({ where: { id: grant.id } });
    await prisma.sokoBot.delete({ where: { id: copyBot.id } });
    await prisma.project.delete({ where: { id: copyProject.id } });
  });

  it("keeps one weekly 750-credit audit while CMO is paid, pauses it while not, and skips a week the credits cannot cover", async () => {
    await setCredits(2_000n);
    await keepCmoSeoAudit(cuso);
    expect(await monitors()).toHaveLength(0);

    await setSubscribed(true);
    await keepCmoSeoAudit(cuso);
    await keepCmoSeoAudit(cuso);
    const [monitor, ...more] = await monitors();
    expect(more).toHaveLength(0);
    expect(monitor.state).toBe("ACTIVE");
    expect(monitor.expr).toBe("0 6 * * 1");
    expect(monitor.targetRunCount).toBe(31);
    const plan = parseSeoMonitorPlan(monitor.description);
    expect(plan?.analysis).toMatchObject({
      kind: "audit_full",
      fullAuditCredits: SEO_FULL_AUDIT_CREDITS,
      devices: ["mobile", "desktop"],
      countryCode: "US",
    });

    // The first audit starts at once, unless the weekly Run is under two days away.
    const firstAudits = await prisma.projectSeoAnalysis.findMany({
      where: { projectId, kind: "audit_full" },
      select: { status: true, taskId: true },
    });
    const weeklyRunIsFar =
      (monitor.nextRunAt?.getTime() ?? 0) - Date.now() > 2 * 86_400_000;
    expect(firstAudits).toHaveLength(weeklyRunIsFar ? 1 : 0);
    if (weeklyRunIsFar) {
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: firstAudits[0].taskId ?? "" },
        select: { assigneeId: true, ownerId: true, projectId: true },
      });
      expect(task).toEqual({
        assigneeId: coworkerId,
        ownerId: userId,
        projectId,
      });
      expect((await readCmoSeo(cuso)).audit.running).toBe(true);
    }

    const run = await prisma.taskScheduleRun.findFirstOrThrow({
      where: { scheduleId: monitor.id, state: "PLANNED", manual: false },
      orderBy: { effectiveScheduledAt: "asc" },
    });
    const soon = new Date(Date.now() + 20 * 60_000);
    await prisma.taskScheduleRun.update({
      where: { id: run.id },
      data: { effectiveScheduledAt: soon, originalScheduledAt: soon },
    });
    await setCredits(BigInt(SEO_FULL_AUDIT_CREDITS - 1));
    await keepCmoSeoAudit(cuso);
    expect(
      (
        await prisma.taskScheduleRun.findUniqueOrThrow({
          where: { id: run.id },
        })
      ).state,
    ).toBe("SKIPPED");
    const tab = await readCmoSeo(cuso);
    expect(tab.audit).toMatchObject({
      status: "active",
      creditsPerAudit: 750,
      skipped: [soon.toISOString()],
    });

    await setSubscribed(false);
    await keepCmoSeoAudit(cuso);
    expect((await monitors())[0].state).toBe("PAUSED");
    expect((await readCmoSeo(cuso)).audit.status).toBe("paused");

    await setCredits(2_000n);
    await setSubscribed(true);
    await keepCmoSeoAudit(cuso);
    expect((await monitors())[0].state).toBe("ACTIVE");
  });

  it("starts the next monitor once one has used its 31 Runs, when the credits cover a week", async () => {
    const [first] = await monitors();
    await prisma.taskSchedule.update({
      where: { id: first.id },
      data: { state: "ENDED", nextRunAt: null },
    });
    await setCredits(100n);
    await keepCmoSeoAudit(cuso);
    expect(await monitors()).toHaveLength(1);
    expect((await readCmoSeo(cuso)).audit.status).toBe("not_started");
    await setCredits(2_000n);
    await keepCmoSeoAudit(cuso);
    const all = await monitors();
    expect(all).toHaveLength(2);
    expect(all[1].state).toBe("ACTIVE");
    await keepCmoSeoAudit(cuso);
    expect(await monitors()).toHaveLength(2);
  });

  it("shows the latest audit and puts its fixes on the page change list once", async () => {
    await storeAudit(report, new Date("2026-11-16T23:47:36.703Z"));
    const tab = await readCmoSeo(cuso);
    expect(tab.audit.latest).toMatchObject({
      observedAt: "2026-11-16T23:47:36.703Z",
    });
    expect(tab.audit.latest?.checked).toBeGreaterThan(0);
    expect(tab.audit.latest?.issues.length).toBeGreaterThan(0);
    expect(
      tab.audit.latest?.issues.every((issue) =>
        ["critical", "major", "minor"].includes(issue.severity),
      ),
    ).toBe(true);
    expect(tab.pageChanges).toHaveLength(report.actions.length);
    expect(tab.pageChanges[0]).toMatchObject({
      source: "audit",
      status: "open",
      pageUrl: "https://battery-sensei.app/",
    });
    expect(tab.pageChanges[0].evidence[0]).toMatchObject({
      metric: "auditIssue",
      source: "weekly_audit",
    });
    expect((await readCmoSeo(cuso)).pageChanges).toHaveLength(
      report.actions.length,
    );
  });

  it("verifies a done audit fix once a later audit no longer finds it", async () => {
    const tab = await readCmoSeo(cuso);
    const redirect = tab.pageChanges.find((change) =>
      change.evidence.some((e) => e.value === "Permanent redirects"),
    );
    if (!redirect) throw new Error("fixture has the redirect fix");
    await setCmoSeoSuggestionStatus(
      { userId, projectId },
      redirect.id,
      "done",
      new Date("2026-11-17T10:00:00Z"),
    );
    await verifyCmoSeoChanges(cuso);
    expect(
      (await readCmoSeo(cuso)).pageChanges.find((c) => c.id === redirect.id)
        ?.status,
    ).toBe("done");

    const withRedirectCheck = (result: "pass" | "not_checked") => ({
      ...report,
      findings: report.findings.filter(
        (finding: { rowId: string }) => finding.rowId !== "AC-10",
      ),
      checks: report.checks.map((check: { rowId: string }) =>
        check.rowId === "AC-10" ? { ...check, result } : check,
      ),
    });
    // An audit that could not run the check finds nothing and confirms nothing.
    await storeAudit(
      withRedirectCheck("not_checked"),
      new Date("2026-11-20T06:10:00Z"),
    );
    await verifyCmoSeoChanges(cuso);
    expect(
      (await readCmoSeo(cuso)).pageChanges.find((c) => c.id === redirect.id)
        ?.status,
    ).toBe("done");

    await storeAudit(
      withRedirectCheck("pass"),
      new Date("2026-11-23T06:10:00Z"),
    );
    await verifyCmoSeoChanges(cuso);
    const after = (await readCmoSeo(cuso)).pageChanges.find(
      (c) => c.id === redirect.id,
    );
    expect(after).toMatchObject({
      status: "verified",
      verifiedAt: "2026-11-23T06:10:00.000Z",
    });
  });

  it("attaches measured numbers to Cuso's articles and refuses one it has none for", async () => {
    const search = await searchCmoKeywords(cuso, "MacBook battery health app");
    expect(search.ideas[0]).toMatchObject({
      keyword: "macbook battery health app",
      searchVolume: 140,
      difficulty: 1,
    });
    const charge = search.ideas.find(
      (i) => i.keyword === "macbook charge limit",
    );
    expect(charge).toMatchObject({ position: null });

    const saved = await saveCmoSeoSuggestions(cuso, {
      articles: [
        {
          title: "The best battery health app for your MacBook",
          keyword: "macbook battery health app",
          why: "Buyers comparing apps search this; the site does not rank yet.",
          outline: "## What to look for\n## How Battery Sensei helps",
        },
        {
          title: "Why MacBook batteries swell",
          keyword: "why do macbook batteries swell",
          why: "A guess with no numbers behind it.",
          outline: "## Causes\n## What to do",
        },
      ],
      pageChanges: [
        {
          pageUrl: "https://example.com/",
          title: "Rewrite another site's title",
          change: "Change the title tag of the homepage.",
          newText: "Something",
          why: "Not the brand's site.",
        },
      ],
    });
    expect(saved.saved).toHaveLength(1);
    expect(saved.refused.join(" ")).toMatch(/why do macbook batteries swell/);
    expect(saved.refused.join(" ")).toMatch(/example\.com/);
    const article = (await readCmoSeo(cuso)).articles[0];
    expect(article.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "searchVolume",
          value: "140",
          source: "keyword_research",
        }),
        expect.objectContaining({ metric: "difficulty", value: "1" }),
      ]),
    );
  });

  it("keeps CMO search receipts separate, reuses its weekly result and saves a billed vendor refusal", async () => {
    const today = new Date();
    const term = "How to choose a shelf";
    const topic = "small spaces";
    vi.mocked(fetchKeywordIdeas).mockImplementationOnce(
      async (_q, observed) => {
        await observed!({
          costUsd: 0.014,
          taskId: "vendor-search",
          exactKeywords: [term.toLowerCase()],
        });
        return [
          {
            keyword: term,
            searchVolume: 30,
            difficulty: 12,
            intent: "informational",
            cpc: null,
          },
        ];
      },
    );
    vi.mocked(askCmoEditor).mockImplementation(async (model) => ({
      model,
      phrases: model === EDITORS[0] ? [term] : [],
      costUsd: model === EDITORS[0] ? 0.02 : 0.01,
      generationId: null,
      status: model === EDITORS[0] ? "ok" : "failed",
    }));
    const search = await searchCmoKeywords(cuso, topic, today);
    expect(search.ideas[0]).toMatchObject({ keyword: term, editorial: true });
    expect(await searchCmoKeywords(cuso, topic, today)).toEqual(search);
    expect(
      vi
        .mocked(askCmoEditor)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual([...EDITORS].sort());
    const rows = await prisma.projectSeoResearch.findMany({
      where: {
        projectId: cuso.projectId,
        kind: "keyword_research_run",
        key: { contains: topic },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      status: "complete",
      totalUsd: expect.closeTo(0.044),
    });
    const lines = await prisma.projectSeoResearch.findMany({
      where: {
        projectId: cuso.projectId,
        kind: "keyword_research_charge",
        key: { startsWith: rows[0].id },
      },
    });
    expect(lines.map((l) => l.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: EDITORS[1],
          status: "failed",
          costUsd: 0.01,
        }),
        expect.objectContaining({ source: "dataforseo", costUsd: 0.014 }),
      ]),
    );
    // A later topic may contain a related winning phrase in the prior purchase, while its own signed row reports zero results.
    vi.mocked(fetchKeywordIdeas).mockImplementationOnce(
      async (_q, observed) => {
        await observed!({
          costUsd: 0.009,
          taskId: "vendor-second",
          exactKeywords: [],
        });
        return [];
      },
    );
    const later = new Date(today.getTime() + 1000);
    const related = await searchCmoKeywords(cuso, "reading room", later);
    expect(related.ideas).toContainEqual(
      expect.objectContaining({
        keyword: term,
        editorial: true,
        measuredAt: today.toISOString(),
      }),
    );
    vi.mocked(fetchKeywordIdeas).mockImplementationOnce(
      async (_q, observed) => {
        await observed!({
          costUsd: 0.012,
          taskId: "billed-refusal",
          exactKeywords: [],
        });
        throw new Error("vendor refused");
      },
    );
    await expect(
      searchCmoKeywords(cuso, "failed source", today),
    ).rejects.toThrow("vendor refused");
    await expect(
      searchCmoKeywords(cuso, "failed source", today),
    ).rejects.toThrow("already started");
    const bad = await prisma.projectSeoResearch.findFirstOrThrow({
      where: {
        projectId: cuso.projectId,
        kind: "keyword_research_run",
        key: { contains: "failed source" },
      },
    });
    expect(bad.payload).toMatchObject({
      status: "failed",
      knownUsd: 0.012,
      totalUsd: 0.012,
    });
    const line = await prisma.projectSeoResearch.findFirstOrThrow({
      where: {
        projectId: cuso.projectId,
        kind: "keyword_research_charge",
        key: { startsWith: bad.id },
      },
    });
    expect(line.payload).toMatchObject({
      reference: "billed-refusal",
      status: "failed",
      costUsd: 0.012,
    });
  });

  it("uses the repeat topic’s single purchase for ranked unseen phrases and keeps the original baseline date", async () => {
    const start = new Date("2026-04-02T09:30:00.000Z");
    const at = (days: number) => new Date(start.getTime() + days * 86_400_000);
    const topic = "workshop shelves";
    const baseline = "paint a workshop shelf";
    const row = (keyword: string) => ({
      keyword,
      searchVolume: 120,
      difficulty: 25,
      cpc: null,
      intent: "informational" as const,
    });
    const discoveries = vi.mocked(fetchKeywordIdeas);
    const overviews = vi.mocked(fetchKeywordOverview);
    const events: string[] = [];
    const discovery = async (
      _q: Parameters<typeof fetchKeywordIdeas>[0],
      save: Parameters<typeof fetchKeywordIdeas>[1],
    ) => {
      events.push("suggestions");
      await save!({
        costUsd: 0.012,
        taskId: "baseline-task",
        exactKeywords: [baseline],
      });
      return [row(baseline)];
    };
    discoveries.mockImplementationOnce(discovery);
    let phrases: string[] = [];
    vi.mocked(askCmoEditor).mockImplementation(async (model, input) => {
      expect(input).toMatchObject({
        countryCode: "US",
        languageCode: "en",
        asOf: expect.stringMatching(/^2026-/),
      });
      events.push(model);
      return {
        model,
        phrases: model === EDITORS[0] ? phrases : [],
        costUsd: 0.01,
        generationId: null,
        status: "ok",
      };
    });
    await searchCmoKeywords(cuso, topic, start);
    expect(events[0]).toBe("suggestions");
    const novel = [
      "adjustable shelf spacing",
      "mount shelf uprights",
      "hang a tool rail",
      "fourth suggestion",
    ];
    phrases = [baseline, ...novel];
    overviews.mockImplementationOnce(async (q, terms, save) => {
      expect(q).toMatchObject({
        topic,
        locationCode: 2840,
        languageCode: "en",
      });
      expect(terms).toEqual(novel.slice(0, 3));
      events.push("overview");
      await save({
        costUsd: 0.011,
        taskId: "overview-task",
        exactKeywords: terms,
      });
      return terms.map(row);
    });
    events.length = 0;
    const refreshed = await searchCmoKeywords(cuso, topic, at(8));
    expect(events.slice(0, 2).sort()).toEqual([...EDITORS].sort());
    expect(events.slice(2)).toEqual(["overview"]);
    expect(refreshed.ideas).toContainEqual(
      expect.objectContaining({
        keyword: novel[0],
        editorial: true,
        searchVolume: 120,
      }),
    );
    expect(refreshed.ideas).not.toContainEqual(
      expect.objectContaining({ keyword: novel[3] }),
    );
    expect(
      refreshed.ideas.find((i) => i.keyword === baseline)?.measuredAt,
    ).toBe(start.toISOString());
    const saved = await prisma.projectSeoResearch.findFirstOrThrow({
      where: {
        projectId: cuso.projectId,
        kind: "keyword_ideas",
        key: { startsWith: topic + "|" },
      },
    });
    expect(saved.payload).toMatchObject({
      baseline: {
        source: "suggestions",
        taskId: "baseline-task",
        measuredAt: start.toISOString(),
      },
      native: {
        source: "overview",
        taskId: "overview-task",
        measuredAt: at(8).toISOString(),
      },
    });
    expect(await searchCmoKeywords(cuso, topic, at(10))).toEqual(refreshed);
    phrases = [...novel.slice(0, 3), "shelving brackets"];
    overviews.mockImplementationOnce(async (_q, terms, save) => {
      expect(terms).toEqual(["shelving brackets"]);
      await save({
        costUsd: 0.01,
        taskId: "overview-two",
        exactKeywords: terms,
      });
      return terms.map(row);
    });
    await searchCmoKeywords(cuso, topic, at(16));
    phrases = [novel[0], "install shelf hooks"];
    overviews.mockImplementationOnce(async (_q, terms, save) => {
      expect(terms).toEqual(["install shelf hooks"]);
      await save({
        costUsd: 0.01,
        taskId: "overview-three",
        exactKeywords: terms,
      });
      return terms.map(row);
    });
    const later = await searchCmoKeywords(cuso, topic, at(24));
    expect(later.ideas.find((i) => i.keyword === novel[0])?.measuredAt).toBe(
      at(8).toISOString(),
    );
    // Intervening searches have not extended the original discovery measurement's 30-day life.
    events.length = 0;
    discoveries.mockImplementationOnce(discovery);
    await searchCmoKeywords(cuso, topic, at(31));
    expect(events[0]).toBe("suggestions");
    // The new baseline is current, but both editors propose only its already measured phrase.
    events.length = 0;
    phrases = [baseline];
    discoveries.mockImplementationOnce(discovery);
    await searchCmoKeywords(cuso, topic, at(39));
    expect(events.slice(0, 2).sort()).toEqual([...EDITORS].sort());
    expect(events.slice(2)).toEqual(["suggestions"]);
  });
  it("admits one CMO purchase across concurrent requests and a day change", async () => {
    let started!: () => void;
    let finish!: () => void;
    const dispatched = new Promise<void>((r) => {
      started = r;
    });
    const held = new Promise<void>((r) => {
      finish = r;
    });
    vi.mocked(fetchKeywordIdeas).mockImplementationOnce(async (_q, receipt) => {
      started();
      await held;
      await receipt!({
        costUsd: 0.01,
        taskId: "charged-only-once",
        exactKeywords: [],
      });
      return [];
    });
    const before = new Date("2026-11-19T23:59:59Z");
    const key = "parallel shelves";
    const first = searchCmoKeywords(cuso, key, before);
    await dispatched;
    try {
      await expect(searchCmoKeywords(cuso, key, before)).rejects.toThrow(
        "already started",
      );
      await expect(
        searchCmoKeywords(cuso, key, new Date(before.getTime() + 2_000)),
      ).rejects.toThrow("already started");
    } finally {
      finish();
    }
    await first;
    const purchases = await prisma.projectSeoResearch.findMany({
      where: {
        projectId: cuso.projectId,
        kind: "keyword_research_run",
        key: { contains: key },
      },
    });
    expect(purchases).toHaveLength(1);
  });

  it("answers a position check from its imported result, and says when it failed", async () => {
    const task = await prisma.task.create({
      data: {
        name: "SEO rankings",
        workspaceId,
        projectId,
        status: "COMPLETED",
        ownerId: userId,
      },
    });
    const analysis = await prisma.projectSeoAnalysis.create({
      data: {
        projectId,
        idempotencyKey: randomUUID(),
        requestHash: "x",
        kind: "rankings",
        status: "completed",
        taskId: task.id,
        request: { keywords: ["macbook charge limit"] },
        requestedBy: userId,
      },
    });
    await prisma.projectSeoObservation.create({
      data: {
        projectId,
        kind: "rankings",
        source: "seo_coworker",
        sourceKey: `test:${randomUUID()}`,
        sourceTaskId: task.id,
        pageIds: [],
        artifactHash: randomUUID(),
        payload: {
          ...report,
          kind: "rankings",
          keywords: [
            {
              ...report.keywords[0],
              keyword: "macbook charge limit",
              position: 14,
            },
          ],
        },
        observedAt: new Date("2026-11-18T08:00:00Z"),
      },
    });
    const outcome = await seoCheckOutcome(analysis.id);
    expect(outcome).toMatch(/2026-11-18/);
    expect(outcome).toMatch(
      /"macbook charge limit" \(mobile, US\): position 14/,
    );

    await prisma.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: { status: "failed", failureReason: "The worker timed out" },
    });
    expect(await seoCheckOutcome(analysis.id)).toMatch(
      /failed: The worker timed out\. Nothing was charged/,
    );
  });

  it("runs a failed position check again the same day", async () => {
    const keywords = ["macbook battery widget"];
    const failedRow = await prisma.projectSeoAnalysis.create({
      data: {
        projectId,
        idempotencyKey: randomUUID(),
        requestHash: "x",
        kind: "rankings",
        status: "failed",
        request: { keywords },
        requestedBy: userId,
      },
    });
    // Still "requested", but its Task was canceled: failed all the same.
    const canceled = await prisma.task.create({
      data: {
        name: "SEO rankings",
        workspaceId,
        projectId,
        status: "CANCELED",
        ownerId: userId,
      },
    });
    const stuckRow = await prisma.projectSeoAnalysis.create({
      data: {
        projectId,
        idempotencyKey: randomUUID(),
        requestHash: "x",
        kind: "rankings",
        taskId: canceled.id,
        request: { keywords },
        requestedBy: userId,
      },
    });

    // The weekly audit of the tests above is still running: one check at a time.
    const running = await prisma.task.findMany({
      where: {
        projectId,
        archivedAt: null,
        status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
      },
      select: { id: true },
    });
    const runningIds = running.map((task) => task.id);
    await prisma.task.updateMany({
      where: { id: { in: runningIds } },
      data: { archivedAt: new Date() },
    });

    const again = await checkCmoSearchRankings(cuso, keywords);
    expect(again.status).toBe("started");
    const started = "analysisId" in again ? again.analysisId : "";
    expect([failedRow.id, stuckRow.id]).not.toContain(started);
    // The new check is the one a second ask follows.
    expect(await checkCmoSearchRankings(cuso, keywords)).toEqual({
      status: "running",
      analysisId: started,
    });
    const { taskId } = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { id: started },
      select: { taskId: true },
    });
    await prisma.task.updateMany({
      where: { id: taskId ?? "" },
      data: { status: "CANCELED" },
    });
    await prisma.task.updateMany({
      where: { id: { in: runningIds } },
      data: { archivedAt: null },
    });
  });

  it("refuses a suggestion the owner skipped, and caps page changes like articles", async () => {
    const article = {
      title: "Set a charge limit on your MacBook",
      keyword: "macbook charge limit",
      why: "Buyers search this before they buy.",
      outline: "## Why a limit\n## How to set it",
    };
    const first = await saveCmoSeoSuggestions(cuso, { articles: [article] });
    expect(first.saved).toHaveLength(1);
    await setCmoSeoSuggestionStatus(
      { userId, projectId },
      first.saved[0].id,
      "dismissed",
    );

    const again = await saveCmoSeoSuggestions(cuso, {
      articles: [{ ...article, title: "Charge limits, explained" }],
    });
    expect(again.saved).toEqual([]);
    expect(again.refused.join(" ")).toMatch(/owner skipped this one/);
    const row = await prisma.projectSeoSuggestion.findUniqueOrThrow({
      where: { id: first.saved[0].id },
    });
    expect(row).toMatchObject({ status: "dismissed", title: article.title });

    // Thirty open suggestions: a new page change is refused, as an article is.
    const open = await prisma.projectSeoSuggestion.count({
      where: { projectId, status: "open" },
    });
    await prisma.projectSeoSuggestion.createMany({
      data: Array.from({ length: 30 - open }, (_, at) => ({
        projectId,
        kind: "article",
        key: `article:filler-${at}`,
        source: "cuso",
        title: `Filler ${at}`,
        body: "x",
        why: "x",
        evidence: [],
      })),
    });
    const page = (await readCmoSeo(cuso)).pageChanges[0];
    const capped = await saveCmoSeoSuggestions(cuso, {
      pageChanges: [
        {
          pageUrl: page.pageUrl ?? "",
          title: "A change nobody suggested before",
          change: "Rewrite the first paragraph.",
          newText: "New words",
          why: "The audit flagged this page.",
        },
      ],
    });
    expect(capped.saved).toEqual([]);
    expect(capped.refused.join(" ")).toMatch(/already holds 30 open/);
    await prisma.projectSeoSuggestion.deleteMany({
      where: { projectId, key: { startsWith: "article:filler-" } },
    });
  });

  it("reads the fixes of a report of several pages, whose finding ids carry the page's index", async () => {
    const before = (await readCmoSeo(cuso)).pageChanges.length;
    await storeAudit(
      {
        ...report,
        findings: report.findings.map((finding: { id: string }) => ({
          ...finding,
          id: `0:${finding.id}`,
        })),
        actions: report.actions.map(
          (action: { id: string; findingIds: string[] }) => ({
            ...action,
            id: `0:${action.id}`,
            findingIds: action.findingIds.map((id) => `0:${id}`),
          }),
        ),
      },
      new Date("2026-11-30T06:10:00Z"),
    );
    // The same fixes as the single-page report: no new rows, none keyed by the index.
    const after = await readCmoSeo(cuso);
    expect(after.pageChanges).toHaveLength(before);
    expect(
      await prisma.projectSeoSuggestion.count({
        where: { projectId, key: { endsWith: ":0" } },
      }),
    ).toBe(0);
  });

  it("saves a landing page backed by the competitor's own words, and points the waiting ad at it once it is live", async () => {
    const competitor = await prisma.trackedCompetitor.create({
      data: {
        projectId,
        name: "AlDente",
        nameKey: "aldente",
        websiteUrl: "https://apphousekitchen.com/",
        source: "RESEARCH",
      },
      select: { id: true },
    });
    await prisma.projectSeoResearch.create({
      data: {
        projectId,
        kind: "comparison_searches",
        key: "aldente|US|en",
        observedAt: new Date("2026-11-19T09:00:00Z"),
        payload: {
          name: "AlDente",
          countryCode: "US",
          languageCode: "en",
          searches: [
            {
              keyword: "aldente alternative",
              searchVolume: 90,
              cpc: 1.2,
              lowTopOfPageBid: 0.4,
              highTopOfPageBid: 2,
              competition: "LOW",
            },
          ],
        },
      },
    });
    const draft = [
      "# AlDente alternative that shows what wears your battery",
      "",
      "Looking for an AlDente alternative? Battery Sensei shows which habits wear your MacBook battery and limits the charge for you.",
      "",
      "## What it costs",
      "",
      "AlDente Pro costs 12 EUR a year or 25 EUR once. Battery Sensei is a single purchase.",
      "",
      "If you only want a charge limit, AlDente's free version does that.",
      "",
      "Battery Sensei runs on every MacBook with Apple silicon and needs no account to start.",
    ].join("\n");
    const page = {
      keyword: "aldente alternative",
      competitor: "AlDente",
      why: "People who search this are choosing a battery app right now.",
      draft,
      claims: [
        {
          text: "AlDente Pro costs 12 EUR a year or 25 EUR once.",
          sourceUrl: "https://apphousekitchen.com/pricing",
          quote: "Yearly: 12 EUR a year",
        },
        {
          text: "AlDente Pro can be bought once.",
          sourceUrl: "https://apphousekitchen.com/pricing",
          quote: "Lifetime: 25 EUR",
        },
      ],
    };

    // A price the page does not show, a quote that is not there, a search
    // nobody measured, and something no quote says are each refused.
    const refused = async (change: Partial<typeof page>): Promise<string> => {
      const result = await saveCmoSeoSuggestions(cuso, {
        landingPages: [{ ...page, ...change }],
      });
      expect(result.saved).toEqual([]);
      return result.refused.join(" ");
    };
    expect(
      await refused({ draft: draft.replace("12 EUR a year", "19 EUR a year") }),
    ).toMatch(/has a number no source gives \(19\)/);
    expect(
      await refused({
        claims: [{ ...page.claims[0]!, quote: "Yearly: 9 EUR a year" }],
      }),
    ).toMatch(
      /"Yearly: 9 EUR a year" is not on https:\/\/apphousekitchen\.com\/pricing/,
    );
    expect(
      await refused({
        claims: [
          {
            ...page.claims[0]!,
            sourceUrl: "https://reviews.example.com/aldente",
          },
        ],
      }),
    ).toMatch(
      /neither AlDente's own site nor a source the weekly check stored/,
    );
    expect(
      await refused({
        keyword: "aldente vs battery sensei",
        draft: draft.replaceAll(
          /AlDente alternative/gi,
          "AlDente vs Battery Sensei",
        ),
      }),
    ).toMatch(/no measured searches/);
    expect(
      await refused({ draft: `${draft}\n\nAlDente is slow to update.` }),
    ).toMatch(
      /"AlDente is slow to update\." says something about AlDente that no cited source says/,
    );
    expect(await refused({ competitor: "CoconutBattery" })).toMatch(
      /not on the competitor watch list/,
    );
    expect(
      await refused({
        draft: draft.replace("# AlDente alternative", "# A better app"),
      }),
    ).toMatch(/H1 .* does not hold the search "aldente alternative"/);

    const saved = await saveCmoSeoSuggestions(cuso, { landingPages: [page] });
    expect(saved.refused).toEqual([]);
    expect(saved.costUsd).toBeGreaterThan(0);
    const [landing] = (await readCmoSeo(cuso)).landingPages;
    expect(landing).toMatchObject({
      kind: "landing_page",
      title: "AlDente alternative that shows what wears your battery",
      keyword: "aldente alternative",
      status: "open",
      pageUrl: null,
      sources: page.claims,
      evidence: [
        expect.objectContaining({
          metric: "searchVolume",
          value: "90",
          source: "keyword_research",
        }),
      ],
    });
    // Saved again, the same search is the same page.
    await saveCmoSeoSuggestions(cuso, { landingPages: [page] });
    expect((await readCmoSeo(cuso)).landingPages).toHaveLength(1);

    // Two search ads on that search: one waiting, one already launched.
    const strategy = await prisma.marketingStrategy.create({
      data: {
        projectId,
        plan: {},
        approvedAt: new Date(),
        approvedByUserId: userId,
      },
      select: { id: true },
    });
    const ad = {
      keywords: ["AlDente Alternative", "aldente alternatives"],
      headlines: ["AlDente Alternative", "Battery Sensei", "See What Wears It"],
      descriptions: ["See what wears your battery.", "Limit the charge."],
      finalUrl: "https://battery-sensei.app/",
      location: "United States",
    };
    for (const [entryId, adCampaignId] of [
      ["kw-waiting", null],
      ["kw-launched", "campaign-1"],
    ] as const) {
      const file = await prisma.fileResource.create({
        data: {
          workspaceId,
          sourceKind: "DRIVE_UPLOAD",
          sourceScope: "USER",
          sourceId: `users/${userId}/${entryId}.md`,
          ownerUserId: userId,
          displayName: `${entryId}.md`,
          normalizedName: `${entryId}.md`,
        },
        select: { id: true },
      });
      await prisma.marketingStrategyFile.create({
        data: {
          marketingStrategyId: strategy.id,
          entryId,
          fileResourceId: file.id,
          searchAd: ad,
          adCampaignId,
        },
      });
    }

    await expect(
      markCmoLandingPageLive(
        { userId, projectId },
        landing!.id,
        "https://example.com/aldente-alternative",
      ),
    ).rejects.toThrow(/not on battery-sensei\.app/);
    const live = await markCmoLandingPageLive(
      { userId, projectId },
      landing!.id,
      "https://battery-sensei.app/aldente-alternative",
    );
    expect(live).toMatchObject({
      adsUpdated: 1,
      adsLaunched: 1,
      page: {
        status: "done",
        pageUrl: "https://battery-sensei.app/aldente-alternative",
      },
    });
    const files = await prisma.marketingStrategyFile.findMany({
      where: { marketingStrategyId: strategy.id },
      orderBy: { entryId: "asc" },
      select: { entryId: true, searchAd: true },
    });
    expect(
      files.map((file) => [
        file.entryId,
        (file.searchAd as { finalUrl: string }).finalUrl,
      ]),
    ).toEqual([
      ["kw-launched", "https://battery-sensei.app/"],
      ["kw-waiting", "https://battery-sensei.app/aldente-alternative"],
    ]);

    await prisma.marketingStrategy.delete({ where: { id: strategy.id } });
    await prisma.trackedCompetitor.delete({ where: { id: competitor.id } });
  });

  it("lists the weekly audits with where each stands, for the chat", async () => {
    await prisma.projectSeoAnalysis.deleteMany({
      where: { projectId, kind: "audit_full" },
    });
    const now = new Date("2026-11-23T09:00:00Z");
    const audit = (key: string, hoursAgo: number, rest: object = {}) =>
      prisma.projectSeoAnalysis.create({
        data: {
          projectId,
          idempotencyKey: `test-audit-${key}`,
          requestHash: key,
          kind: "audit_full",
          request: {},
          requestedBy: userId,
          createdAt: new Date(now.getTime() - hoursAgo * 3_600_000),
          ...rest,
        },
        select: { id: true },
      });
    // An audit's Task, free again now that its audit row is gone.
    const taken = await prisma.projectSeoAnalysis.findMany({
      where: { projectId, taskId: { not: null } },
      select: { taskId: true },
    });
    const task = await prisma.task.findFirstOrThrow({
      where: {
        workspaceId,
        id: { notIn: taken.flatMap((row) => row.taskId ?? []) },
      },
      select: { id: true },
    });
    const running = await audit("running", 0);
    const stuck = await audit("stuck", 4);
    const failed = await audit("failed", 30, { status: "failed" });
    const done = await audit("done", 170, {
      status: "completed",
      taskId: task.id,
    });
    await prisma.projectSeoObservation.create({
      data: {
        projectId,
        kind: "audit_full",
        source: "seo_coworker",
        sourceKey: `test:${randomUUID()}`,
        sourceTaskId: task.id,
        pageIds: [],
        artifactHash: randomUUID(),
        payload: report as object,
        observedAt: new Date(now.getTime() - 169 * 3_600_000),
      },
    });

    const runs = await listCmoSeoAuditRuns(
      projectId,
      new Date(now.getTime() - 30 * 86_400_000),
      now,
    );

    expect(runs.map((run) => [run.id, run.state])).toEqual([
      [running.id, "running"],
      [stuck.id, "failed"],
      [failed.id, "failed"],
      [done.id, "done"],
    ]);
    expect(runs[3]?.found?.checked).toBeGreaterThan(0);
    expect(runs[3]?.found?.passed).toBeLessThan(runs[3]!.found!.checked);
    expect(runs[3]?.found?.fixes).toBe(Math.min(report.actions.length, 5));
    // An audit before the window is left out.
    expect(
      await listCmoSeoAuditRuns(
        projectId,
        new Date(now.getTime() - 86_400_000),
        now,
      ),
    ).toHaveLength(2);
  });

  it("runs a failed first audit again after an hour, then after six, then leaves it to the weekly Run", async () => {
    const own = await prisma.project.create({
      data: { workspaceId, name: "Cuso", websiteUrl: "https://retry.test/" },
      select: { id: true },
    });
    const bot = await prisma.sokoBot.create({
      data: {
        workspaceId,
        projectId: own.id,
        userId: null,
        createdByUserId: userId,
        versionId: CMO_SOKO_BOT_VERSION_ID,
        name: "Cuso",
      },
    });
    const retrying = await findCusoForBot(bot.id);
    if (!retrying) throw new Error("Cuso fixture missing");
    const grant = await prisma.transaction.create({
      data: { amount: 10_000n * CREDIT, organizationId },
      select: { id: true },
    });
    await prisma.creditBucket.create({
      data: {
        amount: 10_000n * CREDIT,
        organizationId,
        projectId: own.id,
        sourceTransactionId: grant.id,
        referenceType: "CMO_TESTER_CREDITS",
      },
    });
    await keepCmoSeoAudit(retrying);
    const monitor = await prisma.taskSchedule.findFirstOrThrow({
      where: {
        projectId: own.id,
        description: { startsWith: "seo_monitor: " },
      },
    });
    // The weekly Run is days away, and the first audit failed half an hour ago.
    await prisma.taskSchedule.update({
      where: { id: monitor.id },
      data: { nextRunAt: new Date(Date.now() + 5 * 86_400_000) },
    });
    const analyses = () =>
      prisma.projectSeoAnalysis.findMany({
        where: { projectId: own.id, kind: "audit_full" },
        orderBy: { createdAt: "desc" },
      });
    await prisma.projectSeoAnalysis.deleteMany({
      where: { projectId: own.id },
    });
    await prisma.projectSeoAnalysis.create({
      data: {
        projectId: own.id,
        kind: "audit_full",
        status: "failed",
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        request: {},
        requestedBy: userId,
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });
    // The newest try failed and started this long ago; the earlier ones before it.
    const failLatest = async (startedMinutesAgo: number) => {
      const tries = await prisma.projectSeoAnalysis.findMany({
        where: { projectId: own.id },
        orderBy: { id: "desc" },
      });
      await prisma.task.updateMany({
        where: { id: { in: tries.flatMap((row) => row.taskId ?? []) } },
        data: { status: "FAILED" },
      });
      for (const [i, row] of tries.entries())
        await prisma.projectSeoAnalysis.update({
          where: { id: row.id },
          data: {
            status: "failed",
            createdAt: new Date(
              Date.now() - (startedMinutesAgo + i * 24 * 60) * 60_000,
            ),
          },
        });
    };

    await keepCmoSeoAudit(retrying);
    expect(await analyses()).toHaveLength(1);
    const waiting = await readCmoSeoAudit(retrying);
    expect(waiting.failedTries).toBe(1);
    expect(Date.parse(waiting.retryAt ?? "")).toBeGreaterThan(Date.now());

    // A weekly Run due before the retry, or just after it, is the retry.
    await prisma.taskSchedule.update({
      where: { id: monitor.id },
      data: { nextRunAt: new Date(Date.now() + 60 * 60_000) },
    });
    expect((await readCmoSeoAudit(retrying)).retryAt).toBeNull();
    await prisma.taskSchedule.update({
      where: { id: monitor.id },
      data: { nextRunAt: new Date(Date.now() + 5 * 86_400_000) },
    });

    await failLatest(61);
    await keepCmoSeoAudit(retrying);
    expect(await analyses()).toHaveLength(2);
    expect((await readCmoSeoAudit(retrying)).running).toBe(true);

    await failLatest(5 * 60);
    await keepCmoSeoAudit(retrying);
    expect(await analyses()).toHaveLength(2);
    await failLatest(6 * 60 + 1);
    await keepCmoSeoAudit(retrying);
    expect(await analyses()).toHaveLength(3);

    await failLatest(7 * 60);
    await keepCmoSeoAudit(retrying);
    expect(await analyses()).toHaveLength(3);
    expect(await readCmoSeoAudit(retrying)).toMatchObject({
      failedTries: 3,
      retryAt: null,
    });

    await prisma.projectSeoAnalysis.deleteMany({
      where: { projectId: own.id },
    });
    await prisma.task.deleteMany({ where: { projectId: own.id } });
    await prisma.taskSchedule.deleteMany({ where: { projectId: own.id } });
    await prisma.transaction.deleteMany({ where: { id: grant.id } });
    await prisma.sokoBot.delete({ where: { id: bot.id } });
    await prisma.project.delete({ where: { id: own.id } });
  });

  it("pauses the weekly audit of a Cuso that was let go, but not a monitor a person made", async () => {
    const active = (await monitors()).find((m) => m.state === "ACTIVE");
    if (!active) throw new Error("fixture has an active monitor");
    expect(await pauseCmoSeoAuditsWithoutCuso()).toBe(0);

    await prisma.sokoBot.update({
      where: { id: cuso.sokoBotId },
      data: { archivedAt: new Date() },
    });
    const operation =
      await prisma.taskScheduleCreateOperation.findUniqueOrThrow({
        where: { scheduleId: active.id },
      });
    // Under another operation id it is a monitor a person made in this Project.
    await prisma.taskScheduleCreateOperation.update({
      where: { id: operation.id },
      data: { operationId: randomUUID() },
    });
    expect(await pauseCmoSeoAuditsWithoutCuso()).toBe(0);
    await prisma.taskScheduleCreateOperation.update({
      where: { id: operation.id },
      data: { operationId: operation.operationId },
    });

    expect(await pauseCmoSeoAuditsWithoutCuso()).toBe(1);
    const paused = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: active.id },
    });
    expect(paused.state).toBe("PAUSED");
    expect(paused.nextRunAt).toBeNull();
    expect(await pauseCmoSeoAuditsWithoutCuso()).toBe(0);
  });
});
