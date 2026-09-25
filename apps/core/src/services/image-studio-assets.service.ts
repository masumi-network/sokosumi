import {
  ProjectImageJobStatus,
  type ProjectImageReviewDecision,
} from "@sokosumi/database";
import { get } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { internalServerError, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { requireProjectAccess } from "@/lib/image-studio/access";

/**
 * Versions, lineage, review decisions, and the bytes behind them.
 *
 * Nothing in this module returns a URL that anyone could fetch without coming
 * back through Core. `blobPathname` is a storage coordinate, not a handle, and
 * it never leaves the server.
 */

export interface AssetView {
  id: string;
  rootId: string;
  parentId: string | null;
  version: number;
  prompt: string;
  model: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
  createdAt: Date;
  jobId: string;
  review: {
    decision: ProjectImageReviewDecision;
    feedback: string | null;
    decidedAt: Date;
    decidedByUserId: string;
  } | null;
}

const assetSelect = {
  id: true,
  rootId: true,
  parentId: true,
  version: true,
  prompt: true,
  model: true,
  width: true,
  height: true,
  bytes: true,
  contentType: true,
  createdAt: true,
  jobId: true,
  review: {
    select: {
      decision: true,
      feedback: true,
      decidedAt: true,
      decidedByUserId: true,
    },
  },
} as const;

export async function listAssets(options: {
  projectId: string;
  workspaceId: string;
  userId: string;
  limit: number;
}): Promise<AssetView[]> {
  await requireProjectAccess(options);
  return await prisma.projectImageAsset.findMany({
    where: { projectId: options.projectId },
    orderBy: { createdAt: "desc" },
    take: options.limit,
    select: assetSelect,
  });
}

export async function getAsset(options: {
  assetId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<AssetView> {
  await requireProjectAccess(options);
  const asset = await prisma.projectImageAsset.findFirst({
    where: { id: options.assetId, projectId: options.projectId },
    select: assetSelect,
  });
  if (!asset) throw notFound("Image not found");
  return asset;
}

/**
 * Record a decision about one immutable version.
 *
 * The row is keyed on the asset, so re-deciding replaces this version's own
 * decision and reaches nothing else. A refinement of an approved version has
 * no review row at all until somebody makes one — approval is never inherited
 * because there is no field to inherit it through.
 */
export async function reviewAsset(options: {
  assetId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  decision: ProjectImageReviewDecision;
  feedback: string | null;
}): Promise<AssetView> {
  await requireProjectAccess(options);
  const asset = await prisma.projectImageAsset.findFirst({
    where: { id: options.assetId, projectId: options.projectId },
    select: { id: true },
  });
  if (!asset) throw notFound("Image not found");

  await prisma.projectImageReview.upsert({
    where: { assetId: options.assetId },
    create: {
      assetId: options.assetId,
      decision: options.decision,
      feedback: options.feedback,
      decidedByUserId: options.userId,
    },
    update: {
      decision: options.decision,
      feedback: options.feedback,
      decidedByUserId: options.userId,
      decidedAt: new Date(),
    },
  });

  return await getAsset(options);
}

/** Clears this version's decision, returning it to undecided. */
export async function clearAssetReview(options: {
  assetId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<AssetView> {
  await requireProjectAccess(options);
  await prisma.projectImageReview.deleteMany({
    where: {
      assetId: options.assetId,
      asset: { projectId: options.projectId },
    },
  });
  return await getAsset(options);
}

/**
 * The bytes, for a caller whose access has just been re-checked.
 *
 * Returns a stream rather than buffering: a 4K PNG through a function's memory
 * for every thumbnail render is a cost with nothing to show for it.
 */
export async function openAssetStream(options: {
  assetId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
  checksum: string;
}> {
  await requireProjectAccess(options);
  const asset = await prisma.projectImageAsset.findFirst({
    where: { id: options.assetId, projectId: options.projectId },
    select: { blobPathname: true, contentType: true, checksum: true },
  });
  if (!asset) throw notFound("Image not found");

  const result = await get(asset.blobPathname, {
    access: "private",
    token: getEnv().BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200) {
    throw notFound("Image bytes are no longer available");
  }
  return {
    stream: result.stream,
    contentType: asset.contentType || result.blob.contentType,
    size: result.blob.size,
    checksum: asset.checksum,
  };
}

/** Server-internal read used when building a provider reference. */
export async function readAssetBytes(
  blobPathname: string,
): Promise<Uint8Array> {
  const result = await get(blobPathname, {
    access: "private",
    token: getEnv().BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200) {
    throw internalServerError("Reference image bytes are unavailable");
  }
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * One lineage, oldest first, so a comparison view can walk it.
 */
export async function listLineage(options: {
  rootId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<AssetView[]> {
  await requireProjectAccess(options);
  return await prisma.projectImageAsset.findMany({
    where: { rootId: options.rootId, projectId: options.projectId },
    orderBy: { version: "asc" },
    select: assetSelect,
  });
}

export interface JobView {
  id: string;
  status: ProjectImageJobStatus;
  kind: string;
  prompt: string;
  error: string | null;
  parentAssetId: string | null;
  assetId: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  settledAt: Date | null;
  /** True when a retry could buy a second image. */
  retryMayDuplicateCharge: boolean;
}

export async function listJobs(options: {
  projectId: string;
  workspaceId: string;
  userId: string;
  limit: number;
}): Promise<JobView[]> {
  await requireProjectAccess(options);
  const jobs = await prisma.projectImageJob.findMany({
    where: { projectId: options.projectId },
    orderBy: { createdAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      status: true,
      kind: true,
      prompt: true,
      error: true,
      parentAssetId: true,
      createdAt: true,
      submittedAt: true,
      settledAt: true,
      asset: { select: { id: true } },
    },
  });
  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    kind: job.kind,
    prompt: job.prompt,
    error: job.error,
    parentAssetId: job.parentAssetId,
    assetId: job.asset?.id ?? null,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    settledAt: job.settledAt,
    retryMayDuplicateCharge:
      job.status === ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
  }));
}
