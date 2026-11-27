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

type Stored = { id: string; observedAt: Date; payload: Prisma.JsonValue };

function readAudit(row: Stored): RecheckAudit | null {
  const parsed = publicSeoPayloadSchema.safeParse(row.payload);
  return parsed.success
    ? { id: row.id, observedAt: row.observedAt, payload: parsed.data }
    : null;
}

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
async function isCustomerProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true, testCopyOfProjectId: true },
  });
  if (!project || project.testCopyOfProjectId) return false;
  const evalLanes = await prisma.evalLane.count({
    where: {
      OR: [{ workspaceId: project.workspaceId }, { cusoProjectId: projectId }],
    },
  });
  return evalLanes === 0;
}

/**
 * The newest audit of a Project or SEO audit checks the actions of the earlier ones. An action whose rules all close
 * becomes done, and while impact tracking is on each page it closed on becomes a tracked audit_recheck change. An older
 * audit imported late changes nothing.
 */
export async function recheckSeoAudit(observationId: string): Promise<void> {
  const row = await prisma.projectSeoObservation.findUnique({
    where: { id: observationId },
    select: {
      id: true,
      projectId: true,
      auditId: true,
      kind: true,
      payload: true,
      observedAt: true,
    },
  });
  if (!row || !PAGE_RULE_KINDS.has(row.kind)) return;
  const owner = row.projectId
    ? { projectId: row.projectId }
    : row.auditId
      ? { auditId: row.auditId }
      : null;
  if (!owner) return;
  const kind = { in: [...PAGE_RULE_KINDS] };
  const newer = await prisma.projectSeoObservation.count({
    where: { ...owner, kind, observedAt: { gt: row.observedAt } },
  });
  const next = readAudit(row);
  if (newer || !next) return;
  const earlier = (
    await prisma.projectSeoObservation.findMany({
      where: { ...owner, kind, observedAt: { lt: row.observedAt } },
      orderBy: { observedAt: "desc" },
      take: RECHECK_HISTORY,
      select: { id: true, observedAt: true, payload: true },
    })
  ).flatMap((item) => readAudit(item) ?? []);
  if (!earlier.length) return;
  const stored = await prisma.projectSeoAuditActionStatus.findMany({
    where: { observationId: { in: earlier.map((audit) => audit.id) } },
    select: { observationId: true, actionId: true, status: true, pairs: true },
  });
  const prior = new Map(
    stored.map((item) => [
      JSON.stringify([item.observationId, item.actionId]),
      // This job wrote both fields.
      {
        status: item.status as RecheckStatus,
        pairs: item.pairs as unknown as RecheckPair[],
      } satisfies PriorRecheck,
    ]),
  );
  const priorOf = (id: string, actionId: string) =>
    prior.get(JSON.stringify([id, actionId]));
  const changed = recheckSeoAuditActions(next, earlier, priorOf).filter(
    (item) =>
      COMPARED.has(item.status) &&
      priorOf(item.observationId, item.actionId)?.status !== item.status,
  );
  if (!changed.length) return;
  const done = changed.filter((item) => item.status === "done");
  const track =
    done.length > 0 &&
    getEnv().SEO_IMPACT_TRACKING_ENABLED &&
    !!row.projectId &&
    (await isCustomerProject(row.projectId));
  await prisma.$transaction(async (tx) => {
    for (const item of changed) {
      const data = {
        status: item.status,
        checkedObservationId: next.id,
        pairs: jsonInput(item.pairs),
        closedAt: item.status === "done" ? next.observedAt : null,
      };
      // A done action stays done, also against a concurrent recheck.
      const { count } = await tx.projectSeoAuditActionStatus.updateMany({
        where: {
          observationId: item.observationId,
          actionId: item.actionId,
          status: { not: "done" },
        },
        data,
      });
      if (!count)
        await tx.projectSeoAuditActionStatus.createMany({
          data: [
            {
              observationId: item.observationId,
              actionId: item.actionId,
              ...data,
            },
          ],
          skipDuplicates: true,
        });
    }
    if (!track || !row.projectId) return;
    const pages = pageChanges(done);
    // Cuso's own record of a change on the page in the same span is the better source.
    const cuso = await tx.projectSeoImpactVerdict.findMany({
      where: {
        projectId: row.projectId,
        changeSource: "cuso_done",
        changedAt: {
          gte: new Date(Math.min(...pages.map((page) => +page.earliest))),
          lte: next.observedAt,
        },
      },
      select: { pageUrl: true, changedAt: true },
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
        projectId: row.projectId!,
        changeSource: "audit_recheck",
        changedAt: page.earliest,
        changeEarliest: page.earliest,
        changeLatest: next.observedAt,
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
  });
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
