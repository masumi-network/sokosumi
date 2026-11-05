import type { Prisma } from "@sokosumi/database";
import { isOwnedTaskFileUrl, isVercelBlobPublicHost } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { SeoActor } from "@/schemas/project-seo.schema";

import {
  commitSeoMutation,
  normalizeSeoUrl,
  requireSeoProject,
  SEO_ARTIFACT_MAX_BYTES,
  SEO_ARTIFACT_TIMEOUT_MS,
  type SeoMutationHooks,
  sha256,
} from "./project-seo-store";

async function requireSourceFile(
  actor: SeoActor,
  input: { taskId: string; fileId: string },
  client: Prisma.TransactionClient = prisma,
) {
  const task = await client.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: actor.workspaceId,
      ownerId: actor.userId,
      visibility: "PUBLIC",
      archivedAt: null,
      status: "COMPLETED",
      OR: [{ projectId: actor.projectId }, { projectId: null }],
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
    file.name !== `seo-report-${task.id}.json` ||
    file.mimeType !== "application/json" ||
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
  return { task, file, fileUrl: file.fileUrl };
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

export async function importProjectSeoAudit(
  actor: SeoActor,
  input: { taskId: string; fileId: string },
  options: SeoMutationHooks & { fetchImpl?: typeof fetch } = {},
) {
  await requireSeoProject(actor, prisma, true);
  const { task, file, fileUrl } = await requireSourceFile(actor, input);
  const sourceKey = `task-file:${file.id}`;
  const existing = await prisma.projectSeoObservation.findUnique({
    where: { projectId_sourceKey: { projectId: actor.projectId, sourceKey } },
  });
  if (existing)
    return serializableTransaction(async (tx) => {
      await requireSeoProject(actor, tx, true);
      await requireSourceFile(actor, input, tx);
      await options.authorize?.(tx);
      return commitSeoMutation(tx, existing, options);
    }, "The report import changed. Please retry.");
  const body = await readSeoArtifact(fileUrl, options.fetchImpl ?? fetch);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw badRequest("The SEO report is not valid JSON");
  }
  const payload = parsePublicSeoArtifact(raw),
    artifactHash = sha256(body);
  const analysis = await prisma.projectSeoAnalysis.findUnique({
    where: { taskId: task.id },
  });
  if (analysis && analysis.projectId !== actor.projectId)
    throw notFound("The analysis belongs to another Project");
  if (payload.requestId && (!analysis || payload.requestId !== analysis.id))
    throw badRequest("The SEO result does not match its requested analysis");
  if (analysis) assertSeoArtifactMatchesRequest(raw, payload, analysis);
  return serializableTransaction(async (tx) => {
    await requireSeoProject(actor, tx, true);
    await options.authorize?.(tx);
    const current = await requireSourceFile(actor, input, tx);
    if (
      current.file.fileUrl !== fileUrl ||
      current.task.assigneeId !== task.assigneeId ||
      current.file.size !== file.size
    )
      throw conflict("The source report changed during import");
    const prior = await tx.projectSeoObservation.findUnique({
      where: { projectId_sourceKey: { projectId: actor.projectId, sourceKey } },
    });
    if (prior) {
      if (prior.artifactHash !== artifactHash)
        throw conflict("The source report changed after it was imported");
      return commitSeoMutation(tx, prior, options);
    }
    const pageIds: string[] = [];
    for (const value of payload.pageUrls) {
      const url = normalizeSeoUrl(value);
      const page = await tx.projectSeoPage.upsert({
        where: { projectId_url: { projectId: actor.projectId, url } },
        create: {
          projectId: actor.projectId,
          url,
          relationship: pageIds.length ? "related" : "primary",
          relatedToPageId: pageIds[0] ?? null,
        },
        update: {},
      });
      pageIds.push(page.id);
    }
    const data: Prisma.InputJsonObject = payload;
    const observation = await tx.projectSeoObservation.create({
      data: {
        projectId: actor.projectId,
        kind: payload.kind,
        source: "seo_coworker",
        sourceKey,
        sourceTaskId: task.id,
        sourceFileId: file.id,
        pageIds,
        scopeVersion: analysis?.scopeVersion ?? 0,
        artifactHash,
        payload: data,
        observedAt: new Date(payload.observedAt),
      },
    });
    if (analysis)
      await tx.projectSeoAnalysis.update({
        where: { id: analysis.id },
        data: { status: "completed", failureReason: null },
      });
    return commitSeoMutation(tx, observation, options);
  }, "The SEO report import changed. Please retry.");
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
  const project = await prisma.project.findUnique({
    where: { id: analysis.projectId },
    select: { workspaceId: true },
  });
  if (!project) return;
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: project.workspaceId,
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
        projectId: analysis.projectId,
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
    await prisma.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "failed",
        failureReason:
          "The source report or its current authority could not be validated",
      },
    });
  }
}
