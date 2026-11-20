import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  CONSOLE_LINK_EXPORTS,
  parseConsoleExport,
} from "@/lib/seo/search-console-export";
import { consoleExportActions } from "@/lib/seo/search-console-export-actions";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  type ConsoleExportInput,
  type ConsoleExportSnapshot,
  consoleExportChecks,
  consoleExportReason,
  consoleExportSnapshot,
} from "@/schemas/seo-console-export.schema";
import { requireNotCmoProject } from "./cmo-cuso.service";
import { listProjectSeoStatisticsProperties } from "./project-seo-statistics.service";
import { seoOwnerData, seoOwnerWhere, sha256 } from "./project-seo-store";
import { readAuditSearchConsoleBinding } from "./seo-audit-performance";
import {
  canInspectConsoleReason,
  inspectConsoleExamples,
} from "./seo-console-example-inspection";

const source = "search_console_csv";
const kindPrefix = "console_export:";
const groupCount =
  CONSOLE_LINK_EXPORTS.length + consoleExportReason.options.length;
const previewLimit = 12;

export function summarizeConsoleExport(
  current: ConsoleExportSnapshot,
  previous: ConsoleExportSnapshot | null,
  audited: Set<string>,
) {
  const comparable =
    previous &&
    previous.date < current.date &&
    previous.kind === current.kind &&
    previous.reason === current.reason
      ? previous
      : null;
  const earlier = new Map(comparable?.rows.map((row) => [row.key, row.counts]));
  const keys = new Set(current.rows.map((row) => row.key));
  const isPage = [
    "indexing_examples",
    "internal_pages",
    "linked_pages",
  ].includes(current.kind);
  const entries = current.rows.map((row) => ({
    ...row,
    auditedUrl: isPage && audited.has(row.key),
    previousCounts: earlier.get(row.key) ?? null,
  }));
  // Show audited URLs first. For links, the next rows have the largest reported count.
  function weight(row: (typeof entries)[number]) {
    return (
      row.counts.incomingLinks ??
      row.counts.internalLinks ??
      row.counts.linkingPages ??
      row.counts.anchorLinks ??
      0
    );
  }
  entries.sort(
    (a, b) =>
      Number(b.auditedUrl) - Number(a.auditedUrl) || weight(b) - weight(a),
  );
  if (current.kind === "anchor_text") {
    const empty = entries.findIndex((row) => row.key === "");
    if (empty > 0) entries.unshift(...entries.splice(empty, 1));
  }
  return {
    kind: current.kind,
    reason: current.reason,
    date: current.date,
    previousDate: comparable?.date ?? null,
    sampleSize: keys.size,
    newInSample: comparable
      ? entries.filter((row) => !earlier.has(row.key)).length
      : null,
    absentFromSample: comparable
      ? [...earlier.keys()].filter((key) => !keys.has(key)).length
      : null,
    entries: entries.slice(0, previewLimit),
  };
}

const inspectionKind = "console_csv_inspection";
const changed = "The approved audit changed. Please try again.";
type Client = Prisma.TransactionClient;

async function context(
  tx: Client,
  actor: SeoActor,
  taskId: string,
  write: boolean,
) {
  const binding = await readAuditSearchConsoleBinding(tx, taskId, actor);
  if (!binding) throw notFound("The approved audit is unavailable");
  const projectId =
    actor.owner.kind === "project"
      ? actor.owner.id
      : (
          await tx.seoAudit.findUnique({
            where: { id: actor.owner.id },
            select: { projectId: true },
          })
        )?.projectId;
  if (write && actor.owner.kind === "audit" && projectId)
    await requireNotCmoProject(projectId, actor.workspaceId, tx);
  const scope = projectId ? ["project", projectId] : ["audit", actor.owner.id];
  const prefix =
    sha256(
      JSON.stringify([
        actor.workspaceId,
        actor.userId,
        scope,
        binding.access.propertyId,
        binding.access.connectionVersion,
      ]),
    ) + ":";
  const privateWhere = {
    ownerId: actor.userId,
    visibility: "PRIVATE",
    source,
    sourceKey: { startsWith: prefix },
  };
  const currentWhere = {
    ...privateWhere,
    ...seoOwnerWhere(actor),
    sourceTaskId: taskId,
  };
  const priorWhere = projectId
    ? {
        ...privateWhere,
        OR: [
          { projectId, auditId: null },
          {
            projectId: null,
            audit: {
              is: {
                workspaceId: actor.workspaceId,
                projectId,
                deletedAt: null,
                archivedAt: null,
              },
            },
          },
        ],
      }
    : { ...privateWhere, ...seoOwnerWhere(actor) };
  return {
    access: binding.access,
    prefix,
    currentWhere,
    priorWhere,
    audited: new Set(binding.pages.map(({ url }) => new URL(url).href)),
  };
}
type Context = Awaited<ReturnType<typeof context>>;

async function previousSample(
  tx: Client,
  ctx: Context,
  current: { kind: string; observedAt: Date },
) {
  const where = { ...ctx.priorWhere, kind: current.kind };
  const previous = await tx.projectSeoObservation.findFirst({
    where: { ...where, observedAt: { lt: current.observedAt } },
    orderBy: { observedAt: "desc" },
    select: { payload: true, observedAt: true, artifactHash: true },
  });
  if (!previous) return null;
  // Two independent uploads for the same prior date can disagree. Neither is a reliable baseline.
  const conflicting = await tx.projectSeoObservation.findFirst({
    where: {
      ...where,
      observedAt: previous.observedAt,
      artifactHash: { not: previous.artifactHash },
    },
    select: { id: true },
  });
  return conflicting ? null : consoleExportSnapshot.parse(previous.payload);
}

async function summaries(tx: Client, ctx: Context) {
  // Group in Postgres, so old full CSV payloads never enter this request's memory.
  const groups = await tx.projectSeoObservation.groupBy({
    by: ["kind"],
    where: { ...ctx.currentWhere, kind: { startsWith: kindPrefix } },
    _max: { observedAt: true },
    orderBy: { kind: "asc" },
    take: groupCount,
  });
  const latest = groups.length
    ? await tx.projectSeoObservation.findMany({
        where: {
          ...ctx.currentWhere,
          OR: groups.flatMap(({ kind, _max }) =>
            _max.observedAt ? [{ kind, observedAt: _max.observedAt }] : [],
          ),
        },
        orderBy: [{ observedAt: "desc" }, { kind: "asc" }],
        take: groupCount,
        select: {
          kind: true,
          sourceKey: true,
          observedAt: true,
          payload: true,
        },
      })
    : [];
  const output = [];
  for (const current of latest) {
    const snapshot = consoleExportSnapshot.parse(current.payload);
    const previous = await previousSample(tx, ctx, current);
    const summary = summarizeConsoleExport(snapshot, previous, ctx.audited);
    if (snapshot.kind !== "indexing_examples") {
      const older =
        previous &&
        (snapshot.kind === "linked_pages" || snapshot.kind === "internal_pages")
          ? await previousSample(tx, ctx, {
              kind: current.kind,
              observedAt: new Date(previous.date),
            })
          : null;
      output.push({
        ...summary,
        actions: consoleExportActions(snapshot, previous, older, new Set()),
      });
      continue;
    }
    const record = await tx.projectSeoObservation.findFirst({
      where: {
        ...ctx.currentWhere,
        kind: { in: [inspectionKind, pendingInspectionKind] },
        sourceKey: current.sourceKey + ":checks",
      },
      select: { kind: true, payload: true },
    });
    const checks = new Map(
      inspectionRows(record).map(({ key, inspection }) => [key, inspection]),
    );
    output.push({
      ...summary,
      actions: consoleExportActions(
        snapshot,
        previous,
        null,
        new Set(
          [...checks]
            .filter(
              ([, check]) =>
                check.status === "observed" && check.verdict === "PASS",
            )
            .map(([key]) => key),
        ),
      ),
      entries: summary.entries.map((entry) => ({
        ...entry,
        ...(checks.has(entry.key) && { inspection: checks.get(entry.key)! }),
      })),
    });
  }
  return output;
}

const pendingInspectionKind = "console_csv_inspection_pending";
// The Core request deadline is 300 seconds. A crashed caller cannot keep the reservation indefinitely.
const inspectionLeaseMs = 5 * 60 * 1000;
const pendingReceipt = z.object({ previous: consoleExportChecks.optional() });

function inspectionRows(record: { kind: string; payload: unknown } | null) {
  if (!record) return [];
  return record.kind === inspectionKind
    ? consoleExportChecks.parse(record.payload)
    : (pendingReceipt.parse(record.payload).previous ?? []);
}

/** Both owner types have a unique sourceKey. One caller can turn this row into the final receipt. */
async function claimInspection(
  tx: Client,
  actor: SeoActor,
  taskId: string,
  sourceKey: string,
  ctx: Context,
) {
  const receiptKey = sourceKey + ":checks";
  const existing = await tx.projectSeoObservation.findFirst({
    where: { ...ctx.currentWhere, sourceKey: receiptKey },
    select: {
      id: true,
      kind: true,
      observedAt: true,
      artifactHash: true,
      payload: true,
    },
  });
  const now = new Date();
  const cutoff = new Date(now.getTime() - inspectionLeaseMs);
  const busy = () =>
    conflict(
      "These examples are already being inspected. Retry after the current inspection finishes.",
    );
  const previous = inspectionRows(existing);
  const retryKeys = previous
    .filter(
      ({ inspection }) =>
        inspection.status === "unavailable" &&
        new Date(inspection.checkedAt) <= cutoff,
    )
    .map(({ key }) => key);
  if (existing?.kind === inspectionKind && !retryKeys.length) return null;
  const payload = { reservation: randomUUID(), previous };
  const artifactHash = sha256(JSON.stringify(payload));
  const data = {
    kind: pendingInspectionKind,
    observedAt: now,
    payload,
    artifactHash,
  };
  if (existing) {
    if (
      existing.kind !== inspectionKind &&
      (existing.kind !== pendingInspectionKind || existing.observedAt > cutoff)
    )
      throw busy();
    const renewed = await tx.projectSeoObservation.updateMany({
      where: {
        id: existing.id,
        kind: existing.kind,
        artifactHash: existing.artifactHash,
        observedAt: existing.observedAt,
      },
      data,
    });
    if (!renewed.count) throw busy();
    return {
      fence: { id: existing.id, artifactHash, kind: pendingInspectionKind },
      previous,
      retryKeys,
    };
  }
  const id = randomUUID();
  const made = await tx.projectSeoObservation.createMany({
    data: [
      {
        ...seoOwnerData(actor),
        ownerId: actor.userId,
        visibility: "PRIVATE",
        sourceTaskId: taskId,
        source,
        sourceKey: receiptKey,
        pageIds: [],
        id,
        ...data,
      },
    ],
    skipDuplicates: true,
  });
  if (!made.count) throw busy();
  return {
    fence: { id, artifactHash, kind: pendingInspectionKind },
    previous,
    retryKeys,
  };
}

export async function consoleExports(
  actor: SeoActor,
  taskId: string,
  input?: ConsoleExportInput,
) {
  if (!input)
    return serializableTransaction(
      async (tx) => summaries(tx, await context(tx, actor, taskId, false)),
      changed,
    );
  if (input.date > new Date().toISOString().slice(0, 10))
    throw unprocessableEntity("The export date is in the future");

  const prepared = await serializableTransaction(async (tx) => {
    const ctx = await context(tx, actor, taskId, true);
    const reason = input.kind === "indexing_examples" ? input.reason : null;
    const kind = kindPrefix + (reason ?? input.kind);
    const rows = parseConsoleExport(
      input.csv,
      input.kind,
      ctx.access.propertyId,
    );
    const payload = { kind: input.kind, reason, date: input.date, rows };
    const artifactHash = sha256(JSON.stringify(payload));
    const sourceKey = ctx.prefix + [taskId, kind, input.date].join(":");
    const existing = await tx.projectSeoObservation.findFirst({
      where: { ...ctx.currentWhere, kind, sourceKey },
      select: { artifactHash: true },
    });
    if (existing && existing.artifactHash !== artifactHash)
      throw conflict(
        "A different export already exists for this report and date",
      );
    const claim =
      input.kind === "indexing_examples" &&
      input.inspectExamples &&
      rows.length &&
      canInspectConsoleReason(reason)
        ? await claimInspection(tx, actor, taskId, sourceKey, ctx)
        : null;
    return { ctx, kind, payload, sourceKey, artifactHash, claim };
  }, changed);
  const { ctx, kind, payload, sourceKey, artifactHash, claim } = prepared;
  try {
    // Provider calls run outside database transactions. The final transaction rechecks the same binding.
    const choices = await listProjectSeoStatisticsProperties(
      actor,
      "search_console",
    );
    if (!choices.properties.some(({ id }) => id === ctx.access.propertyId))
      throw forbidden(
        "The connected account could not confirm access to the approved Search Console property",
      );
    const inspected = claim
      ? await inspectConsoleExamples(
          actor,
          ctx.access,
          claim.previous.length
            ? claim.retryKeys.map((key) => ({ key }))
            : payload.rows,
          ctx.audited,
          payload.reason,
        )
      : [];
    const checks = claim?.previous.length
      ? claim.previous.map(
          (previous) =>
            inspected.find((row) => row.key === previous.key) ?? previous,
        )
      : inspected;
    return await serializableTransaction(async (tx) => {
      const current = await context(tx, actor, taskId, true);
      if (current.prefix !== ctx.prefix) throw conflict(changed);
      const base = {
        ...seoOwnerData(actor),
        ownerId: actor.userId,
        visibility: "PRIVATE",
        sourceTaskId: taskId,
        source,
        pageIds: [],
        observedAt: new Date(payload.date),
      };
      const existing = await tx.projectSeoObservation.findFirst({
        where: { ...current.currentWhere, kind, sourceKey },
        select: { artifactHash: true },
      });
      if (existing && existing.artifactHash !== artifactHash)
        throw conflict(
          "A different export already exists for this report and date",
        );
      if (!existing)
        await tx.projectSeoObservation.create({
          data: { ...base, kind, sourceKey, artifactHash, payload },
        });
      if (claim) {
        const finished = await tx.projectSeoObservation.updateMany({
          where: claim.fence,
          data: {
            kind: inspectionKind,
            observedAt: base.observedAt,
            artifactHash: sha256(JSON.stringify(checks)),
            payload: checks,
          },
        });
        if (finished.count !== 1) throw conflict(changed);
      }
      return summaries(tx, current);
    }, changed);
  } catch (error) {
    if (claim) {
      // Fence cleanup too: an expired caller cannot release its successor's reservation.
      // If the database is unavailable, a future request can reclaim the expired lease.
      await prisma.projectSeoObservation
        .updateMany({
          where: claim.fence,
          data: { observedAt: new Date(0) },
        })
        .catch(() => {});
    }
    throw error;
  }
}
