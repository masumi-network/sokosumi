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
import prisma from "@/lib/db/prisma";
import { parseSeoMonitorPlan } from "@/lib/seo/monitor-plan";
import { type Cuso, findCusoForBot } from "./cmo-cuso.service";
import {
  readCmoSeo,
  saveCmoSeoSuggestions,
  searchCmoKeywords,
  setCmoSeoSuggestionStatus,
} from "./cmo-seo.service";
import { keepCmoSeoAudit, verifyCmoSeoChanges } from "./cmo-seo-audit.service";
import { seoCheckOutcome } from "./cmo-seo-rankings.service";

vi.mock("@/lib/ads/dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/dataforseo")>()),
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
});
