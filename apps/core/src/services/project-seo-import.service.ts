import type { Prisma } from "@sokosumi/database";
import {
  isOwnedTaskFileUrl,
  isVercelBlobPublicHost,
  seoReportFileFormat,
} from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { jsonInput } from "@/helpers/prisma-json";
import {
  failedPageRuns,
  failedSeoSources,
  failedSeoSpecialists,
  reportObject,
  SEO_REPORT_IMPORT_REJECTED,
  skippedPages,
  withoutApprovedSearchConsole,
} from "@/helpers/project-seo-public-report";
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import { readAuditPlan } from "@/helpers/seo-audit-plan";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";
import { notifySeoMonitorWorseSafely } from "./project-seo-monitor-notify";
import {
  commitSeoMutation,
  normalizeSeoUrl,
  requireLockedSeoOwner,
  requireSeoOwner,
  SEO_ARTIFACT_MAX_BYTES,
  SEO_ARTIFACT_TIMEOUT_MS,
  type SeoMutationHooks,
  seoOwnerData,
  seoOwnerUnique,
  sha256,
} from "./project-seo-store";

async function requireSourceFile(
  actor: SeoActor,
  input: { taskId: string; fileId: string },
  client: Prisma.TransactionClient = prisma,
) {
  const analysis = await client.projectSeoAnalysis.findUnique({
    where: { taskId: input.taskId },
  });
  if (
    analysis &&
    (analysis.requestedBy !== actor.userId ||
      (actor.owner.kind === "audit"
        ? analysis.auditId !== actor.owner.id || analysis.projectId !== null
        : analysis.projectId !== actor.owner.id || analysis.auditId !== null))
  )
    throw notFound("The analysis belongs to another SEO workspace");
  // A dispatched check may finish after its Project closes. Retain that evidence,
  // while ad-hoc imports still require an open Project.
  const owner = await requireSeoOwner(actor, client, !analysis);
  const task = await client.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: actor.workspaceId,
      ownerId: actor.userId,
      visibility: "PUBLIC",
      archivedAt: null,
      status: "COMPLETED",
      OR: owner.projectId
        ? [{ projectId: owner.projectId }, { projectId: null }]
        : [{ projectId: null }],
    },
    select: {
      id: true,
      assigneeId: true,
      files: {
        where: { id: input.fileId },
        select: {
          id: true,
          name: true,
          fileUrl: true,
          mimeType: true,
          size: true,
          status: true,
          uploadedByCoworkerId: true,
        },
      },
    },
  });
  const file = task?.files[0];
  if (
    !task?.assigneeId ||
    !file ||
    file.status !== "READY" ||
    file.uploadedByCoworkerId !== task.assigneeId ||
    seoReportFileFormat(task.id, file.name, file.mimeType) !== "json" ||
    !file.fileUrl ||
    !isOwnedTaskFileUrl(file.fileUrl, task.id) ||
    !isVercelBlobPublicHost(new URL(file.fileUrl).hostname) ||
    new URL(file.fileUrl).protocol !== "https:"
  )
    throw notFound(
      "A completed public SEO report from this Task's Coworker is required",
    );
  if (
    file.size === null ||
    file.size <= 0n ||
    file.size > BigInt(SEO_ARTIFACT_MAX_BYTES)
  )
    throw badRequest("The SEO report has an invalid size");
  return { task, file, fileUrl: file.fileUrl, analysis };
}

async function readSeoArtifact(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(SEO_ARTIFACT_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok || !response.body)
    throw unprocessableEntity("The SEO report file is not available yet");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > SEO_ARTIFACT_MAX_BYTES)
    throw badRequest("The SEO report exceeds the import limit");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > SEO_ARTIFACT_MAX_BYTES)
        throw badRequest("The SEO report exceeds the import limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function recoveryStrategy(
  observation: {
    kind: string;
    source: string;
    sourceTaskId: string | null;
    sourceFileId: string | null;
    payload: unknown;
  },
  input: { taskId: string; fileId: string },
) {
  const stored = reportObject(observation.payload);
  const strategy = reportObject(stored?.strategy);
  if (
    observation.kind !== "audit_full" ||
    observation.source !== "seo_coworker" ||
    observation.sourceTaskId !== input.taskId ||
    observation.sourceFileId !== input.fileId ||
    !stored ||
    !strategy
  )
    throw conflict("This observation has no recoverable site strategy");
  return {
    stored,
    strategy,
    missing: strategy.markets == null && strategy.marketNote == null,
  };
}

export async function importProjectSeoAudit(
  actor: SeoActor,
  input: {
    taskId: string;
    fileId: string;
    recoverMarkets?: boolean;
    recoverPageSpeed?: true;
  },
  options: SeoMutationHooks & { fetchImpl?: typeof fetch } = {},
) {
  const { task, file, fileUrl, analysis } = await requireSourceFile(
    actor,
    input,
  );
  const sourceKey = `task-file:${file.id}`;
  const existing = await prisma.projectSeoObservation.findUnique({
    where: seoOwnerUnique(actor, "sourceKey", { sourceKey }),
  });
  const recover = input.recoverMarkets || input.recoverPageSpeed;
  if (recover && !existing)
    throw notFound("The imported full audit was not found");
  if (
    input.recoverPageSpeed &&
    existing &&
    (existing.kind !== "audit_full" ||
      existing.source !== "seo_coworker" ||
      existing.sourceTaskId !== input.taskId ||
      existing.sourceFileId !== input.fileId)
  )
    throw conflict("This observation has no recoverable PageSpeed section");
  if (
    existing &&
    (!recover ||
      (input.recoverMarkets && !recoveryStrategy(existing, input).missing) ||
      (input.recoverPageSpeed &&
        reportObject(existing.payload)?.pageSpeed !== undefined))
  )
    return serializableTransaction(async (tx) => {
      await requireLockedSeoOwner(tx, actor, !analysis);
      await requireSourceFile(actor, input, tx);
      await options.authorize?.(tx);
      return commitSeoMutation(tx, existing, options);
    }, "The report import changed. Please retry.");
  const body = await readSeoArtifact(fileUrl, options.fetchImpl ?? fetch);
  const artifactHash = sha256(body);
  if (recover && existing?.artifactHash !== artifactHash)
    throw conflict("The source report changed after it was imported");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw badRequest("The SEO report is not valid JSON");
  }
  // Only an audit approved with Search Console may return Search Console sections.
  if (
    storedSeoAuditSearchConsoleSchema.safeParse(analysis?.request).data
      ?.searchConsoleAccess
  )
    raw = withoutApprovedSearchConsole(raw);
  const payload = parsePublicSeoArtifact(raw);
  // The worker's plan binds to the audit's own pages and actions. A plan that is not readable is left out.
  const plan = readAuditPlan(raw, payload);
  if (plan) payload.plan = plan;
  if (input.recoverPageSpeed && payload.kind !== "audit_full")
    throw conflict("The saved report is not a full audit");
  if (input.recoverMarkets && reportObject(raw)?.kind !== "site")
    throw conflict("The saved report is not a site audit");
  if (
    payload.strategy &&
    !payload.strategy.markets &&
    !payload.strategy.marketNote
  )
    payload.strategy.marketNote = "unavailable";
  if (payload.requestId && (!analysis || payload.requestId !== analysis.id))
    throw badRequest("The SEO result does not match its requested analysis");
  if (analysis) assertSeoArtifactMatchesRequest(raw, payload, analysis);
  let createdId: string | null = null;
  const result = await serializableTransaction(async (tx) => {
    createdId = null;
    await requireLockedSeoOwner(tx, actor, !analysis);
    await options.authorize?.(tx);
    const current = await requireSourceFile(actor, input, tx);
    if (
      current.file.fileUrl !== fileUrl ||
      current.task.assigneeId !== task.assigneeId ||
      current.file.size !== file.size
    )
      throw conflict("The source report changed during import");
    const prior = await tx.projectSeoObservation.findUnique({
      where: seoOwnerUnique(actor, "sourceKey", { sourceKey }),
    });
    if (prior) {
      if (prior.artifactHash !== artifactHash)
        throw conflict("The source report changed after it was imported");
      if (input.recoverPageSpeed) {
        const stored = reportObject(prior.payload);
        if (existing?.id !== prior.id || !stored)
          throw conflict("The imported observation changed");
        if (stored.pageSpeed === undefined) {
          const updated = await tx.projectSeoObservation.update({
            where: { id: prior.id },
            data: {
              payload: jsonInput({
                ...stored,
                pageSpeed: payload.pageSpeed ?? [],
              }),
            },
          });
          return commitSeoMutation(tx, updated, options);
        }
      }
      if (input.recoverMarkets) {
        if (prior.id !== existing?.id)
          throw conflict("The imported observation changed");
        const { stored, strategy, missing } = recoveryStrategy(prior, input);
        if (missing) {
          const marketFields = payload.strategy?.markets
            ? { markets: payload.strategy.markets }
            : { marketNote: payload.strategy?.marketNote ?? "unavailable" };
          const updated = await tx.projectSeoObservation.update({
            where: { id: prior.id },
            data: {
              payload: jsonInput({
                ...stored,
                strategy: { ...strategy, ...marketFields },
              }),
            },
          });
          return commitSeoMutation(tx, updated, options);
        }
      }
      return commitSeoMutation(tx, prior, options);
    }
    if (recover) throw conflict("The imported observation changed");
    const pageIds: string[] = [];
    for (const value of payload.pageUrls) {
      const url = normalizeSeoUrl(value);
      const page = await tx.projectSeoPage.upsert({
        where: seoOwnerUnique(actor, "url", { url }),
        create: {
          ...seoOwnerData(actor),
          url,
          relationship: pageIds.length ? "related" : "primary",
          relatedToPageId: pageIds[0] ?? null,
        },
        update: {},
      });
      pageIds.push(page.id);
    }
    const reportPayload =
      analysis && payload.kind === "audit_full"
        ? {
            ...payload,
            ...(reportObject(raw)?.kind === "site" && {
              pageRunFailures: failedPageRuns(skippedPages(raw)),
            }),
            specialistFailures: failedSeoSpecialists(raw),
            sourceFailures: failedSeoSources(raw),
          }
        : payload;
    const observation = await tx.projectSeoObservation.create({
      data: {
        ...seoOwnerData(actor),
        kind: payload.kind,
        source: "seo_coworker",
        sourceKey,
        sourceTaskId: task.id,
        sourceFileId: file.id,
        pageIds,
        scopeVersion: analysis?.scopeVersion ?? 0,
        artifactHash,
        payload: jsonInput(reportPayload),
        observedAt: new Date(payload.observedAt),
      },
    });
    if (analysis)
      await tx.projectSeoAnalysis.update({
        where: { id: analysis.id },
        data: { status: "completed", failureReason: null },
      });
    createdId = observation.id;
    return commitSeoMutation(tx, observation, options);
  }, "The SEO report import changed. Please retry.");
  if (createdId) await notifySeoMonitorWorseSafely(task.id, createdId);
  return result;
}

/** Upload completion supplies only durable IDs. Authority comes from the original dispatch record. */
export async function reconcileProjectSeoTaskFile(
  taskId: string,
  fileId: string,
): Promise<void> {
  const analysis = await prisma.projectSeoAnalysis.findUnique({
    where: { taskId },
  });
  if (!analysis || analysis.status === "completed") return;
  const owner = analysis.auditId
    ? {
        kind: "audit" as const,
        id: analysis.auditId,
        root: await prisma.seoAudit.findUnique({
          where: { id: analysis.auditId, deletedAt: null, archivedAt: null },
          select: { workspaceId: true },
        }),
      }
    : analysis.projectId
      ? {
          kind: "project" as const,
          id: analysis.projectId,
          root: await prisma.project.findUnique({
            where: { id: analysis.projectId },
            select: { workspaceId: true },
          }),
        }
      : null;
  if (!owner?.root) return;
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: owner.root.workspaceId,
      OR: [
        { userId: analysis.requestedBy },
        {
          organization: { members: { some: { userId: analysis.requestedBy } } },
        },
      ],
    },
    select: { id: true, organizationId: true },
  });
  try {
    if (!workspace)
      throw notFound("The original requester no longer has Workspace access");
    await requireAssignedOrganizationSeat(
      analysis.requestedBy,
      workspace.organizationId,
    );
    await importProjectSeoAudit(
      {
        owner: { kind: owner.kind, id: owner.id },
        workspaceId: workspace.id,
        userId: analysis.requestedBy,
        organizationId: workspace.organizationId,
      },
      { taskId, fileId },
    );
  } catch (error) {
    if (
      !(error instanceof HTTPException) ||
      ![400, 403, 404, 409, 422].includes(error.status)
    )
      throw error;
    // A concurrent valid report may have completed this analysis while this file was read.
    await prisma.projectSeoAnalysis.updateMany({
      where: {
        id: analysis.id,
        status: { not: "completed" },
        ...(analysis.auditId && {
          audit: { deletedAt: null, archivedAt: null },
        }),
      },
      data: {
        status: "failed",
        failureReason: SEO_REPORT_IMPORT_REJECTED,
      },
    });
  }
}

export const SEO_TASK_ENDED_WITHOUT_RESULT =
  "The Task failed or was canceled before a result was imported";

/**
 * An analysis follows its Task: one still requested whose Task failed or was
 * canceled is failed too. Runs every minute, so it also settles rows left
 * behind before it existed.
 */
export async function failSeoAnalysesOfEndedTasks(): Promise<number> {
  const open = await prisma.projectSeoAnalysis.findMany({
    where: { status: "requested", taskId: { not: null } },
    select: { taskId: true },
  });
  const taskIds = open.flatMap((row) => (row.taskId ? [row.taskId] : []));
  if (taskIds.length === 0) return 0;
  const ended = await prisma.task.findMany({
    where: { id: { in: taskIds }, status: { in: ["FAILED", "CANCELED"] } },
    select: { id: true },
  });
  if (ended.length === 0) return 0;
  const { count } = await prisma.projectSeoAnalysis.updateMany({
    where: {
      status: "requested",
      taskId: { in: ended.map((task) => task.id) },
    },
    data: { status: "failed", failureReason: SEO_TASK_ENDED_WITHOUT_RESULT },
  });
  return count;
}
