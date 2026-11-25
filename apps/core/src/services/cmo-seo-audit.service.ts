import { createHash } from "node:crypto";
import { ssrfSafeFetch } from "@sokosumi/net";
import { SEO_FULL_AUDIT_CREDITS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { Parser } from "htmlparser2";
import {
  type PublicSeoPayload,
  publicSeoPayloadSchema,
} from "@/helpers/project-seo-report";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { isEvalCusoProject } from "@/lib/evals/eval-guard";
import { recordCoreWarning } from "@/lib/evlog";
import type { EnvVariables } from "@/lib/hono";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { getSeoAnalysisExecution } from "@/lib/seo/analysis-executor-config";
import { requireSeoAnalysisBalance } from "@/lib/seo/analysis-price";
import { parseSeoMonitorPlan } from "@/lib/seo/monitor-plan";
import type { CmoSeoAudit } from "@/schemas/cmo-seo.schema";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { SEO_MAX_MONITOR_RUNS } from "@/schemas/project-seo-monitor.schema";
import { cmoPaidFor } from "@/services/cmo-billing.service";
import {
  type Cuso,
  cmoPayer,
  cmoRunnerUserId,
  LIVE_CUSO_WHERE,
} from "@/services/cmo-cuso.service";
import { addProjectSeoPage } from "@/services/project-seo.service";
import { createProjectSeoMonitor } from "@/services/project-seo-monitor.service";
import { normalizeSeoUrl } from "@/services/project-seo-store";
import { testCopyFamilyProjectIds } from "@/services/project-test-copy";
import {
  changeTaskScheduleRun,
  changeTaskScheduleState,
  runTaskScheduleNow,
} from "@/services/task-schedule.service";
import { cmoSeoMarket } from "./cmo-seo-market";

/** Monday 06:00 UTC: the audit is done before the owner's week starts in Europe. */
const WEEKLY_AUDIT_RULE = {
  expr: "0 6 * * 1",
  timezone: "UTC",
  intervalDays: null,
  anchorAt: null,
  endsMode: "AFTER" as const,
  endsOn: null,
  targetRunCount: SEO_MAX_MONITOR_RUNS,
};
/** A Run this close that the credits cannot cover is skipped, so it never starts late. */
const SKIP_WINDOW_MS = 60 * 60 * 1000;
/** A new Cuso gets his first audit at once unless the weekly Run is this close. */
const FIRST_AUDIT_GAP_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * A failed first audit runs again this long after each failed try started:
 * after an hour, then after six; then the weekly Run takes over (Patrick,
 * 2026-11-20).
 */
const FIRST_AUDIT_RETRY_WAITS_MS = [60 * 60 * 1000, 6 * 60 * 60 * 1000];
/** A test copy starts no audit while its family had one this recently (ADR 0073). */
const TEST_COPY_AUDIT_GAP_MS = 7 * 24 * 60 * 60 * 1000;
/** Monitors `cmoSeoMonitors` reads per Project, so the generations a Project can have. */
const MONITORS_READ = 20;
const ISSUE_SEVERITIES = ["critical", "major", "minor"] as const;
const TOP_ISSUES = 6;
const TOP_READINGS = 12;
const TOP_FIXES = 5;
const PAGE_BYTES = 2 * 1024 * 1024;

/** The weekly full audits CMO keeps for a Project: SEO monitors on the configured audit service, newest first. */
async function cmoSeoMonitors(projectId: string) {
  const { executor } = getSeoAnalysisExecution();
  if (!executor) return [];
  const schedules = await prisma.taskSchedule.findMany({
    where: {
      projectId,
      assigneeId: executor.coworkerId,
      description: { startsWith: "seo_monitor: " },
    },
    orderBy: { createdAt: "desc" },
    take: MONITORS_READ,
  });
  return schedules.filter(
    (schedule) =>
      parseSeoMonitorPlan(schedule.description)?.analysis.kind === "audit_full",
  );
}

/** Route variables for a write CMO makes on the business's behalf, as the member Cuso runs as. */
function runnerVars(
  workspaceId: string,
  userId: string,
  organizationId: string,
): EnvVariables["Variables"] {
  return {
    isAuthenticated: true,
    authContext: {
      actor: "user",
      userId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    },
    workspaceContext: { workspaceId, userId: null, organizationId },
    // CMO runs on Mainnet only.
    networkScope: createNetworkScope("mainnet"),
  } as EnvVariables["Variables"];
}

export async function cmoSeoActor(cuso: Cuso): Promise<SeoActor | null> {
  const userId = await cmoRunnerUserId(cuso);
  if (!userId) return null;
  const { organizationId } = await cmoPayer(cuso);
  return {
    owner: { kind: "project", id: cuso.projectId },
    workspaceId: cuso.workspaceId,
    userId,
    organizationId,
  };
}

/** The brand's homepage as an SEO page of the Project, made once. */
export async function cmoSeoHomePage(
  cuso: Cuso,
  actor: SeoActor,
): Promise<{ id: string; url: string }> {
  const url = normalizeSeoUrl(cuso.websiteUrl);
  const existing = await prisma.projectSeoPage.findFirst({
    where: { projectId: cuso.projectId, url },
    select: { id: true, url: true },
  });
  if (existing) return existing;
  await addProjectSeoPage(actor, { url, relationship: "primary" });
  return prisma.projectSeoPage.findFirstOrThrow({
    where: { projectId: cuso.projectId, url },
    select: { id: true, url: true },
  });
}

function isRefusal(error: unknown): boolean {
  return error instanceof HTTPException && error.status < 500;
}

/**
 * Keeps one weekly full audit of the brand's site while CMO is paid for
 * (its subscription is the owner's approval of 750 credits a week): starts
 * the SEO monitor and its first audit, starts the next one once its 31 Runs are used up, pauses
 * it while nothing pays, and skips a week its credits cannot cover rather
 * than run it late. Runs in the CMO production sync.
 */
export async function keepCmoSeoAudit(
  cuso: Cuso,
  now: Date = new Date(),
): Promise<void> {
  const { enabled, executor } = getSeoAnalysisExecution();
  if (!enabled || !executor?.canSchedule || !cuso.websiteUrl) return;
  if (await isEvalCusoProject(cuso.projectId)) return;
  const actor = await cmoSeoActor(cuso);
  if (!actor?.organizationId) return;
  const vars = runnerVars(cuso.workspaceId, actor.userId, actor.organizationId);
  const monitors = await cmoSeoMonitors(cuso.projectId);
  const live = monitors.find((schedule) => schedule.state !== "ENDED");
  const paid = await cmoPaidFor(cuso.projectId, now, prisma);
  if (!paid.subscribed && !paid.testerCreditsLeft) {
    if (live?.state === "ACTIVE")
      await changeTaskScheduleState(vars, live.id, "pause");
    return;
  }
  if (live?.state === "PAUSED") {
    await changeTaskScheduleState(vars, live.id, "resume");
    return;
  }
  if (!live) {
    // A daily test copy audits the same site as its source: one audit a week
    // for all of them, and the copy reads that one (`latestCmoSeoAudit`).
    if (await testCopyAuditedSince(cuso.projectId, now)) return;
    const page = await cmoSeoHomePage(cuso, actor);
    const market = await cmoSeoMarket(cuso);
    // Short of 750 credits: no monitor yet; a later sync starts it once they cover a week.
    const monitor = await createProjectSeoMonitor(
      vars,
      actor,
      {
        operationId: operationIdFor(cuso.projectId, monitors.length),
        rule: WEEKLY_AUDIT_RULE,
        analysis: {
          kind: "audit_full",
          pageIds: [page.id],
          keywords: [],
          countryCode: market.countryCode,
          languageCode: market.languageCode,
          devices: ["mobile", "desktop"],
          competitorUrls: [],
          maxProviderCalls: 20,
          fullAuditCredits: SEO_FULL_AUDIT_CREDITS,
          idempotencyKey: "monitor-template",
        },
      },
      "cmo-subscription",
    ).catch((error: unknown) => {
      if (!isRefusal(error)) throw error;
      return null;
    });
    // The first audit runs now, so the tab is not empty for up to a week;
    // not when the weekly Run is about to come anyway.
    const next = monitor?.nextRunAt ? new Date(monitor.nextRunAt) : null;
    if (
      monitor &&
      monitors.length === 0 &&
      next &&
      next.getTime() - now.getTime() > FIRST_AUDIT_GAP_MS
    )
      await runTaskScheduleNow(
        vars,
        monitor.id,
        {
          expectedRevision: monitor.revision,
        },
        "cmo-subscription",
      ).catch((error: unknown) => {
        if (!isRefusal(error)) throw error;
      });
    return;
  }
  if (live.state === "ACTIVE") {
    const { retryAt } = await firstAuditRetry(cuso.projectId, live, now);
    if (retryAt && retryAt <= now) {
      await runTaskScheduleNow(
        vars,
        live.id,
        { expectedRevision: live.revision },
        "cmo-subscription",
      ).catch((error: unknown) => {
        if (!isRefusal(error)) throw error;
      });
      return;
    }
  }
  await skipUnaffordableWeek(live, actor, vars, now);
}

/**
 * When a first audit that failed runs again. Only while no audit of the
 * Project ever finished and every try failed; none once the tries are used
 * up, or when the weekly Run comes first.
 */
export async function firstAuditRetry(
  projectId: string,
  monitor: { nextRunAt: Date | null },
  now: Date,
): Promise<{ failedTries: number; retryAt: Date | null }> {
  if (await latestCmoSeoAudit(projectId))
    return { failedTries: 0, retryAt: null };
  const runs = await listCmoSeoAuditRuns(projectId, new Date(0), now);
  if (!runs.length || runs.some((run) => run.state !== "failed"))
    return { failedTries: 0, retryAt: null };
  const wait = FIRST_AUDIT_RETRY_WAITS_MS[runs.length - 1];
  const retryAt = wait ? new Date(runs[0].startedAt.getTime() + wait) : null;
  const weeklyFirst =
    retryAt &&
    monitor.nextRunAt &&
    monitor.nextRunAt.getTime() <=
      retryAt.getTime() + FIRST_AUDIT_RETRY_WAITS_MS[0];
  return {
    failedTries: runs.length,
    retryAt: weeklyFirst ? null : retryAt,
  };
}

/**
 * Whether the Project is a test copy whose source, or another copy of it,
 * had a full audit in the last week that did not fail.
 */
async function testCopyAuditedSince(
  projectId: string,
  now: Date,
): Promise<boolean> {
  const family = await testCopyFamilyProjectIds(projectId);
  if (!family) return false;
  const audit = await prisma.projectSeoAnalysis.findFirst({
    where: {
      projectId: { in: family },
      kind: "audit_full",
      status: { not: "failed" },
      createdAt: { gte: new Date(now.getTime() - TEST_COPY_AUDIT_GAP_MS) },
    },
    select: { id: true },
  });
  return audit !== null;
}

/** A stable UUID per Project and monitor generation, so a retried sync makes one monitor. */
function operationIdFor(projectId: string, generation: number): string {
  const hex = createHash("sha256")
    .update(`cmo-seo-weekly:${projectId}:${generation}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A Cuso that was let go (archived or deleted) leaves the production sync, so
 * `keepCmoSeoAudit` never pauses his weekly audit and it would go on charging
 * the organization 750 credits a week. This pauses the monitors CMO made
 * (known by their operation id) in Projects without a live Cuso; a monitor a
 * person made in the same Project stays theirs. A Cuso hired again for the
 * Project resumes it.
 */
export async function pauseCmoSeoAuditsWithoutCuso(): Promise<number> {
  const { executor } = getSeoAnalysisExecution();
  if (!executor) return 0;
  const orphans = await prisma.taskSchedule.findMany({
    where: {
      state: "ACTIVE",
      assigneeId: executor.coworkerId,
      description: { startsWith: "seo_monitor: " },
      ownerId: { not: null },
      organizationId: { not: null },
      project: { sokoBots: { none: LIVE_CUSO_WHERE } },
    },
    select: {
      id: true,
      projectId: true,
      workspaceId: true,
      ownerId: true,
      organizationId: true,
      createOperation: { select: { operationId: true } },
    },
  });
  let paused = 0;
  for (const schedule of orphans) {
    const { projectId, ownerId, organizationId, createOperation } = schedule;
    if (!projectId || !ownerId || !organizationId || !createOperation) continue;
    const madeByCmo = Array.from({ length: MONITORS_READ }, (_, generation) =>
      operationIdFor(projectId, generation),
    ).includes(createOperation.operationId);
    if (!madeByCmo) continue;
    await changeTaskScheduleState(
      runnerVars(schedule.workspaceId, ownerId, organizationId),
      schedule.id,
      "pause",
    );
    paused += 1;
  }
  return paused;
}

async function skipUnaffordableWeek(
  schedule: { id: string; revision: number },
  actor: SeoActor,
  vars: EnvVariables["Variables"],
  now: Date,
): Promise<void> {
  const run = await prisma.taskScheduleRun.findFirst({
    where: {
      scheduleId: schedule.id,
      state: "PLANNED",
      effectiveScheduledAt: {
        gt: now,
        lte: new Date(now.getTime() + SKIP_WINDOW_MS),
      },
    },
    orderBy: { effectiveScheduledAt: "asc" },
    select: { id: true },
  });
  if (!run) return;
  try {
    await requireSeoAnalysisBalance(
      prisma,
      {
        userId: actor.userId,
        organizationId: actor.organizationId,
        projectId: actor.owner.id,
      },
      SEO_FULL_AUDIT_CREDITS,
    );
    return;
  } catch (error) {
    if (!isRefusal(error)) throw error;
  }
  await changeTaskScheduleRun(vars, schedule.id, run.id, {
    action: "skip",
    expectedRevision: schedule.revision,
  });
}

/**
 * The latest weekly audit of the Project, as its stored report. A test copy
 * reads the latest of its family: the same site, audited once a week.
 */
export async function latestCmoSeoAudit(
  projectId: string,
): Promise<{ id: string; observedAt: Date; payload: PublicSeoPayload } | null> {
  const family = await testCopyFamilyProjectIds(projectId);
  const row = await prisma.projectSeoObservation.findFirst({
    where: {
      projectId: family ? { in: family } : projectId,
      kind: "audit_full",
      ownerId: null,
    },
    orderBy: { observedAt: "desc" },
    select: { id: true, observedAt: true, payload: true },
  });
  if (!row) return null;
  const parsed = publicSeoPayloadSchema.safeParse(row.payload);
  return parsed.success
    ? { id: row.id, observedAt: row.observedAt, payload: parsed.data }
    : null;
}

/** What the audit found, in the order the owner should read it. */
export function cmoAuditSummary(
  observedAt: Date,
  payload: PublicSeoPayload,
): NonNullable<CmoSeoAudit["latest"]> {
  const findingKey = (finding: { rowId: string; pageUrl: string }) =>
    `${finding.rowId}|${normalizeSeoUrl(finding.pageUrl)}`;
  const isIssue = (severity: string) =>
    ISSUE_SEVERITIES.some((known) => known === severity);
  // One rule on a phone and on a desktop is one thing to read.
  const once = (findings: PublicSeoPayload["findings"]) => {
    const seen = new Set<string>();
    return findings.filter((finding) => {
      const key = findingKey(finding);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const found = payload.findings.filter((finding) => isIssue(finding.severity));
  const issues = once(found)
    .flatMap((finding) => {
      const severity = ISSUE_SEVERITIES.find((s) => s === finding.severity);
      return severity
        ? [
            {
              title: finding.title,
              pageUrl: finding.pageUrl,
              severity,
              detail: finding.evidence[0] ?? null,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        ISSUE_SEVERITIES.indexOf(a.severity) -
        ISSUE_SEVERITIES.indexOf(b.severity),
    )
    .slice(0, TOP_ISSUES);
  const ran = payload.checks.filter(
    (check) => check.result === "pass" || check.result === "fired",
  );
  // A check that did not pass either found something to fix or only recorded
  // a value (a title's length, a position): the second kind is no problem.
  const issueKeys = new Set(found.map(findingKey));
  const fired = ran.filter((check) => check.result === "fired");
  const failedChecks = fired.filter((check) =>
    issueKeys.has(findingKey(check)),
  ).length;
  return {
    observedAt: observedAt.toISOString(),
    checked: ran.length,
    passed: ran.length - fired.length,
    failedChecks,
    readingChecks: fired.length - failedChecks,
    issues,
    readings: once(
      payload.findings.filter((finding) => !isIssue(finding.severity)),
    )
      .slice(0, TOP_READINGS)
      .map((finding) => ({
        title: finding.title,
        pageUrl: finding.pageUrl,
        detail: finding.evidence[0] ?? null,
      })),
    fixes: payload.actions.slice(0, TOP_FIXES).map((action) => ({
      title: action.title,
      why: action.why,
      effort: action.effort,
      pageUrl: action.pageUrl,
    })),
  };
}

/** The weekly audit as the SEO tab shows it. */
export async function readCmoSeoAudit(cuso: Cuso): Promise<CmoSeoAudit> {
  const { enabled, executor } = getSeoAnalysisExecution();
  const monitors = await cmoSeoMonitors(cuso.projectId);
  const live = monitors.find((schedule) => schedule.state !== "ENDED");
  const [skipped, analyses, latest] = await Promise.all([
    monitors.length
      ? prisma.taskScheduleRun.findMany({
          where: {
            scheduleId: { in: monitors.map((schedule) => schedule.id) },
            state: "SKIPPED",
          },
          orderBy: { effectiveScheduledAt: "desc" },
          take: 4,
          select: { effectiveScheduledAt: true },
        })
      : [],
    prisma.projectSeoAnalysis.findMany({
      where: { projectId: cuso.projectId, kind: "audit_full" },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { status: true, createdAt: true, updatedAt: true, taskId: true },
    }),
    latestCmoSeoAudit(cuso.projectId),
  ]);
  const [last] = analyses;
  const task = last?.taskId
    ? await prisma.task.findUnique({
        where: { id: last.taskId },
        select: { status: true },
      })
    : null;
  const failed =
    last &&
    (last.status === "failed" ||
      task?.status === "FAILED" ||
      task?.status === "CANCELED");
  const retry =
    live?.state === "ACTIVE" && failed
      ? await firstAuditRetry(cuso.projectId, live, new Date())
      : { failedTries: 0, retryAt: null };
  return {
    creditsPerAudit: SEO_FULL_AUDIT_CREDITS,
    status:
      !enabled || !executor?.canSchedule
        ? "unavailable"
        : !live
          ? "not_started"
          : live.state === "PAUSED"
            ? "paused"
            : "active",
    nextRunAt:
      live?.state === "ACTIVE" ? (live.nextRunAt?.toISOString() ?? null) : null,
    running: last?.status === "requested" && !failed,
    skipped: skipped.map((run) => run.effectiveScheduledAt.toISOString()),
    latest: latest ? cmoAuditSummary(latest.observedAt, latest.payload) : null,
    lastFailedAt: failed ? last.updatedAt.toISOString() : null,
    retryAt: retry.retryAt?.toISOString() ?? null,
    failedTries: retry.failedTries,
  };
}

/**
 * The weekly SEO audit as one of Cuso's routines in Settings. Core starts it
 * on the monitor's clock (Mondays 06:00 UTC), never a model turn, so it never
 * skips or runs twice; its result comes to the chat as the audit's card and
 * Cuso's report. Null where audits are off or the brand has no site.
 */
export async function cmoSeoAuditRoutine(cuso: Cuso, timeZone: string) {
  const { enabled, executor } = getSeoAnalysisExecution();
  if (!enabled || !executor?.canSchedule || !cuso.websiteUrl) return null;
  const live = (await cmoSeoMonitors(cuso.projectId)).find(
    (schedule) => schedule.state !== "ENDED",
  );
  return {
    key: "cmo-weekly-seo-audit",
    name: "Weekly search check",
    when: "Every Monday morning",
    description:
      "Checks your site the way Google reads it and tells you in the chat what to fix.",
    nextRunAt: live?.state === "ACTIVE" ? live.nextRunAt : null,
    // The clock is UTC; its next run reads in the time zone Cuso works in.
    timezone: timeZone,
  };
}

/** An audit takes about ten minutes; one still running after this never ends. */
const AUDIT_GIVE_UP_MS = 3 * 60 * 60 * 1000;

/** One weekly audit as the chat shows it: when it started and where it stands. */
export interface CmoSeoAuditRun {
  id: string;
  startedAt: Date;
  state: "running" | "done" | "failed";
  /** What it found, once done: checks passed of those run, and things to fix. */
  found: { checked: number; passed: number; fixes: number } | null;
}

/** The Project's weekly audits since `since`, newest first. */
export async function listCmoSeoAuditRuns(
  projectId: string,
  since: Date,
  now: Date = new Date(),
): Promise<CmoSeoAuditRun[]> {
  const analyses = await prisma.projectSeoAnalysis.findMany({
    where: { projectId, kind: "audit_full", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { id: true, status: true, createdAt: true, taskId: true },
  });
  const taskIds = analyses.flatMap((row) => (row.taskId ? [row.taskId] : []));
  const [tasks, reports] = await Promise.all([
    taskIds.length
      ? prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, status: true },
        })
      : [],
    taskIds.length
      ? prisma.projectSeoObservation.findMany({
          where: {
            projectId,
            kind: "audit_full",
            ownerId: null,
            sourceTaskId: { in: taskIds },
          },
          select: { sourceTaskId: true, observedAt: true, payload: true },
        })
      : [],
  ]);
  return analyses.map((analysis) => {
    const task = tasks.find((row) => row.id === analysis.taskId);
    const report = reports.find((row) => row.sourceTaskId === analysis.taskId);
    const parsed = report
      ? publicSeoPayloadSchema.safeParse(report.payload)
      : null;
    const summary = parsed?.success
      ? cmoAuditSummary(report!.observedAt, parsed.data)
      : null;
    const failed =
      analysis.status === "failed" ||
      task?.status === "FAILED" ||
      task?.status === "CANCELED" ||
      (analysis.status === "completed" && !summary) ||
      (analysis.status !== "completed" &&
        now.getTime() - analysis.createdAt.getTime() > AUDIT_GIVE_UP_MS);
    return {
      id: analysis.id,
      startedAt: analysis.createdAt,
      state: failed
        ? "failed"
        : analysis.status === "completed"
          ? "done"
          : "running",
      found:
        !failed && summary
          ? {
              checked: summary.checked,
              passed: summary.passed,
              fixes: summary.fixes.length,
            }
          : null,
    };
  });
}

const UNSEEN_TAGS = new Set(["script", "style", "noscript", "template"]);
const flat = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** What a visitor and Google read on the page: its text, plus its meta descriptions. */
export function pageText(html: string): string {
  const parts: string[] = [];
  let unseen = 0;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (UNSEEN_TAGS.has(name)) unseen += 1;
        parts.push(" ");
        if (name === "meta" && attributes.content)
          parts.push(attributes.content, " ");
      },
      ontext(text) {
        if (unseen === 0) parts.push(text);
      },
      onclosetag(name) {
        parts.push(" ");
        if (UNSEEN_TAGS.has(name) && unseen > 0) unseen -= 1;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  // Text arrives in pieces around each entity: joined as is, with a space only at a tag.
  return flat(parts.join(""));
}

/**
 * Whether the page carries the text (its title, description or heading
 * included); null when the page could not be read.
 */
export async function pageCarriesText(
  pageUrl: string,
  text: string,
): Promise<boolean | null> {
  const response = await ssrfSafeFetch(pageUrl, {
    maxResponseBytes: PAGE_BYTES,
    headers: { "user-agent": "Mozilla/5.0 (compatible; CMO.XYZ page check)" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const wanted = flat(text).slice(0, 160);
  return !!wanted && pageText(await response.text()).includes(wanted);
}

/** Whether the page now carries the new text (its title, description or heading included). */
export async function pageShowsText(
  pageUrl: string,
  text: string,
): Promise<boolean> {
  return (await pageCarriesText(pageUrl, text)) === true;
}

/**
 * After each weekly audit, the page changes the owner marked done are
 * checked: an audit's own finding counts as fixed once the audit ran its
 * check on the page and it passed (a check it could not run confirms
 * nothing); a change Cuso wrote counts once its new text is on the page.
 */
export async function verifyCmoSeoChanges(cuso: Cuso): Promise<void> {
  const latest = await latestCmoSeoAudit(cuso.projectId);
  if (!latest) return;
  const done = await prisma.projectSeoSuggestion.findMany({
    where: {
      projectId: cuso.projectId,
      kind: "page_change",
      status: "done",
      doneAt: { lt: latest.observedAt },
      OR: [{ checkedAt: null }, { checkedAt: { lt: latest.observedAt } }],
    },
  });
  const firing = new Set(
    latest.payload.findings.map(
      (finding) => `${finding.rowId}|${normalizeSeoUrl(finding.pageUrl)}`,
    ),
  );
  const passed = new Set<string>();
  for (const check of latest.payload.checks) {
    const key = `${check.rowId}|${normalizeSeoUrl(check.pageUrl)}`;
    if (check.result === "pass") passed.add(key);
    else if (check.result === "fired") firing.add(key);
  }
  for (const suggestion of done) {
    let fixed = false;
    try {
      if (suggestion.source === "audit") {
        const rowIds = auditRowIds(suggestion.key);
        fixed =
          !!suggestion.pageUrl &&
          rowIds.length > 0 &&
          rowIds.every((rowId) => {
            const key = `${rowId}|${normalizeSeoUrl(suggestion.pageUrl!)}`;
            return passed.has(key) && !firing.has(key);
          });
      } else if (suggestion.pageUrl && suggestion.newText) {
        fixed = await pageShowsText(suggestion.pageUrl, suggestion.newText);
      }
    } catch (error) {
      recordCoreWarning(
        { operation: "cmo_seo_verify", sokoBot: { id: cuso.sokoBotId } },
        {
          message: "Checking a done page change failed",
          why: "The page could not be read",
          fix: "The next weekly audit checks it again.",
        },
        { failure: messageSafeErrorFields(error) },
      );
    }
    await prisma.projectSeoSuggestion.update({
      where: { id: suggestion.id },
      data: {
        checkedAt: latest.observedAt,
        ...(fixed ? { status: "verified", verifiedAt: latest.observedAt } : {}),
      },
    });
  }
}

/** An audit suggestion's key is `audit:<page>:<rowId,rowId>`. */
export function auditSuggestionKey(pageUrl: string, rowIds: string[]): string {
  return `audit:${normalizeSeoUrl(pageUrl)}:${[...new Set(rowIds)].sort().join(",")}`;
}

function auditRowIds(key: string): string[] {
  const rows = key.slice(key.lastIndexOf(":") + 1);
  return rows ? rows.split(",") : [];
}
