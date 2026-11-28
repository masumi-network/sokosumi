import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import { jsonInput } from "@/helpers/prisma-json";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";

import {
  type ActionRecheck,
  type PriorRecheck,
  type RecheckAudit,
  type RecheckPair,
  type RecheckStatus,
  recheckSeoAuditActions,
} from "./project-seo-audit-recheck";
import { PAGE_RULE_KINDS } from "./project-seo-fix-results";
import { normalizeSeoUrl } from "./project-seo-store";

/** The earlier audits a recheck reads. Older open actions leave the compare. */
const RECHECK_HISTORY = 50;
/** A status that says something about the action. A not_compared result keeps the stored one. */
const COMPARED = new Set(["done", "partial", "open"]);
/** The Cuso suggestion statuses impact tracking records as a change (seo-impact-record.ts). */
const CUSO_DONE = ["done", "verified"];
/** A first recheck can write a status for every action of 50 audits. */
const RECHECK_TRANSACTION = { timeout: 30_000 } as const;

type Stored = { id: string; observedAt: Date; payload: Prisma.JsonValue };
type Prior = (
  observationId: string,
  actionId: string,
) => PriorRecheck | undefined;

function readAudit(row: Stored): RecheckAudit | null {
  const parsed = publicSeoPayloadSchema.safeParse(row.payload);
  return parsed.success
    ? { id: row.id, observedAt: row.observedAt, payload: parsed.data }
    : null;
}

const closedPairs = (pairs: RecheckPair[]) =>
  JSON.stringify(
    pairs
      .filter((pair) => pair.outcome === "closed")
      .map((pair) => JSON.stringify([pair.pageUrl, pair.rowId, pair.device]))
      .sort(),
  );

/** A status is written when its label or its closed pairs change: a later recheck reads the closed pairs back. */
export const isChangedRecheck = (
  item: ActionRecheck,
  prior: PriorRecheck | undefined,
) =>
  COMPARED.has(item.status) &&
  (!prior ||
    prior.status !== item.status ||
    closedPairs(prior.pairs) !== closedPairs(item.pairs));

/** One tracked change per page: its closing rows and the span the change went live in. */
function pageChanges(done: ActionRecheck[]) {
  const pages = new Map<
    string,
    {
      pageUrl: string;
      evidence: Array<
        RecheckPair & { observationId: string; actionId: string }
      >;
    }
  >();
  for (const action of done) {
    for (const pair of action.pairs) {
      const key = normalizeSeoUrl(pair.pageUrl);
      const page = pages.get(key) ?? {
        pageUrl: pair.pageUrl,
        evidence: [],
      };
      page.evidence.push({
        ...pair,
        observationId: action.observationId,
        actionId: action.actionId,
      });
      pages.set(key, page);
    }
  }
  return [...pages.entries()].map(([key, page]) => ({
    key,
    ...page,
    earliest: new Date(
      Math.min(
        ...page.evidence.map((pair) => Date.parse(pair.baselineObservedAt!)),
      ),
    ),
  }));
}

/** Only a customer's change is tracked: no test copy, no eval project. */
async function isCustomerProject(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true, testCopyOfProjectId: true },
  });
  if (!project || project.testCopyOfProjectId) return false;
  const evalLanes = await tx.evalLane.count({
    where: {
      OR: [{ workspaceId: project.workspaceId }, { cusoProjectId: projectId }],
    },
  });
  return evalLanes === 0;
}

/** Writes the changed statuses: one insert for the new rows, one update per stored row. */
async function writeStatuses(
  tx: Prisma.TransactionClient,
  next: RecheckAudit,
  changed: ActionRecheck[],
  prior: Prior,
) {
  const data = (item: ActionRecheck) => ({
    status: item.status,
    checkedObservationId: next.id,
    pairs: jsonInput(item.pairs),
    closedAt: item.status === "done" ? next.observedAt : null,
  });
  const fresh = changed.filter(
    (item) => !prior(item.observationId, item.actionId),
  );
  if (fresh.length)
    await tx.projectSeoAuditActionStatus.createMany({
      data: fresh.map((item) => ({
        observationId: item.observationId,
        actionId: item.actionId,
        ...data(item),
      })),
    });
  for (const item of changed) {
    if (!prior(item.observationId, item.actionId)) continue;
    await tx.projectSeoAuditActionStatus.update({
      where: {
        observationId_actionId: {
          observationId: item.observationId,
          actionId: item.actionId,
        },
      },
      data: data(item),
    });
  }
}

/** The pages Cuso already recorded a change on in the span: its own record is the better source. */
async function cusoChanges(
  tx: Prisma.TransactionClient,
  projectId: string,
  span: { gte: Date; lte: Date },
) {
  const [verdicts, suggestions] = await Promise.all([
    tx.projectSeoImpactVerdict.findMany({
      where: { projectId, changeSource: "cuso_done", changedAt: span },
      select: { pageUrl: true, changedAt: true },
    }),
    // A done suggestion the impact tick has not recorded yet.
    tx.projectSeoSuggestion.findMany({
      where: {
        projectId,
        kind: "page_change",
        status: { in: CUSO_DONE },
        pageUrl: { not: null },
        doneAt: span,
      },
      select: { pageUrl: true, doneAt: true },
    }),
  ]);
  return [
    ...verdicts,
    ...suggestions.flatMap((item) =>
      item.pageUrl && item.doneAt
        ? [{ pageUrl: item.pageUrl, changedAt: item.doneAt }]
        : [],
    ),
  ];
}

async function trackPages(
  tx: Prisma.TransactionClient,
  projectId: string,
  next: RecheckAudit,
  done: ActionRecheck[],
  latest: Date,
) {
  const pages = pageChanges(done);
  const cuso = await cusoChanges(tx, projectId, {
    gte: new Date(Math.min(...pages.map((page) => +page.earliest))),
    lte: latest,
  });
  const rows = pages
    .filter(
      (page) =>
        !cuso.some(
          (change) =>
            normalizeSeoUrl(change.pageUrl) === page.key &&
            change.changedAt >= page.earliest,
        ),
    )
    .map((page) => ({
      projectId,
      changeSource: "audit_recheck",
      changedAt: page.earliest,
      changeEarliest: page.earliest,
      changeLatest: latest,
      pageUrl: page.pageUrl,
      recheckAuditId: next.id,
      closingEvidence: jsonInput(
        page.evidence.map((pair) => ({
          observationId: pair.observationId,
          actionId: pair.actionId,
          rowId: pair.rowId,
          device: pair.device,
          ruleKey: pair.ruleKey,
          finalUrl: pair.finalUrl,
          baselineObservationId: pair.baselineObservationId,
          checkedObservationId: pair.checkedObservationId,
        })),
      ),
    }));
  if (rows.length)
    await tx.projectSeoImpactVerdict.createMany({
      data: rows,
      skipDuplicates: true,
    });
}

type RecheckOwner = { projectId: string } | { auditId: string };

async function recheckPendingAudit(
  tx: Prisma.TransactionClient,
  owner: RecheckOwner,
  row: Stored & { createdAt: Date },
) {
  const next = readAudit(row);
  if (!next) return;
  const projectId = "projectId" in owner ? owner.projectId : null;
  const earlier = (
    await tx.projectSeoObservation.findMany({
      where: {
        ...owner,
        kind: { in: [...PAGE_RULE_KINDS] },
        observedAt: { lt: row.observedAt },
        createdAt: { lte: row.createdAt },
      },
      orderBy: { observedAt: "desc" },
      take: RECHECK_HISTORY,
      select: { id: true, observedAt: true, payload: true },
    })
  ).flatMap((item) => readAudit(item) ?? []);
  if (!earlier.length) return;
  const stored = await tx.projectSeoAuditActionStatus.findMany({
    where: { observationId: { in: earlier.map((audit) => audit.id) } },
    select: {
      observationId: true,
      actionId: true,
      status: true,
      pairs: true,
    },
  });
  const statuses = new Map(
    stored.map((item) => [
      JSON.stringify([item.observationId, item.actionId]),
      // This job wrote both fields.
      {
        status: item.status as RecheckStatus,
        pairs: item.pairs as unknown as RecheckPair[],
      } satisfies PriorRecheck,
    ]),
  );
  const prior: Prior = (id, actionId) =>
    statuses.get(JSON.stringify([id, actionId]));
  const changed = recheckSeoAuditActions(next, earlier, prior).filter((item) =>
    isChangedRecheck(item, prior(item.observationId, item.actionId)),
  );
  if (!changed.length) return;
  await writeStatuses(tx, next, changed, prior);
  const done = changed.filter((item) => item.status === "done");
  if (
    !done.length ||
    !projectId ||
    !getEnv().SEO_IMPACT_TRACKING_ENABLED ||
    !(await isCustomerProject(tx, projectId))
  )
    return;
  // A site audit's time is its first page's read. The import came after every page's read.
  const latest = new Date(Math.max(+row.observedAt, +row.createdAt));
  await trackPages(tx, projectId, next, done, latest);
}

/** Process the imports accepted for recheck in capture order, including any earlier retry. */
export async function recheckSeoAudit(observationId: string): Promise<void> {
  const row = await prisma.projectSeoObservation.findUnique({
    where: { id: observationId },
    select: { projectId: true, auditId: true, kind: true },
  });
  if (!row || !PAGE_RULE_KINDS.has(row.kind)) return;
  const owner = row.projectId
    ? { projectId: row.projectId }
    : row.auditId
      ? { auditId: row.auditId }
      : null;
  if (!owner) return;
  const lock = `seo-audit-recheck:${JSON.stringify(owner)}`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}::TEXT, 0))`;
    const pending = await tx.projectSeoObservation.findMany({
      where: { ...owner, needsAuditRecheck: true },
      orderBy: [{ observedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, observedAt: true, createdAt: true, payload: true },
    });
    if (!pending.length) return;
    for (const audit of pending) await recheckPendingAudit(tx, owner, audit);
    await tx.projectSeoObservation.updateMany({
      where: { id: { in: pending.map((audit) => audit.id) } },
      data: { needsAuditRecheck: false },
    });
  }, RECHECK_TRANSACTION);
}

/** After the import committed. A failed recheck never fails the import. */
export async function recheckSeoAuditSafely(
  observationId: string,
): Promise<void> {
  try {
    await recheckSeoAudit(observationId);
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { feature: "seo-audit-recheck" },
      extra: { observationId },
    });
  }
}
