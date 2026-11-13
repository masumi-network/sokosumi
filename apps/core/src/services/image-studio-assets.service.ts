import {
  type Prisma,
  ProjectImageJobStatus,
  ProjectImageMediaType,
} from "@sokosumi/database";
import {
  convertCentsToCredits,
  MAX_STUDIO_BATCH_IMAGES,
} from "@sokosumi/utils";
import { get } from "@vercel/blob";

import { internalServerError, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  requireProjectAccess,
  requireWorkspaceAccess,
} from "@/lib/image-studio/access";
import { requireStudioBlobToken } from "@/lib/image-studio/blob-store";
import {
  type ImageJobFailureReason,
  readImageJobFailureReason,
} from "@/lib/image-studio/failure-reason";
import type {
  StudioAdHeadline,
  StudioAssetRating,
} from "@/schemas/project-image-studio.schema";
import type { StudioProductIdentity } from "@/schemas/studio-product.schema";
import {
  emptyStudioAssetRating,
  getStudioAssetRatings,
} from "./image-studio-feedback.service";

/**
 * Versions, lineage, and the bytes behind them.
 *
 * Nothing in this module returns a URL that anyone could fetch without coming
 * back through Core. `blobPathname` is a storage coordinate, not a handle, and
 * it never leaves the server.
 *
 * That holds because the objects live in the studio's own private-access Blob
 * store, not because of how they are named. If they were ever written to a
 * public store, this paragraph would be false whatever this module returned:
 * the store would serve them on its own URL regardless. See
 * `lib/image-studio/blob-store.ts`.
 */

export interface AssetView extends StudioAssetRating {
  id: string;
  projectId: string;
  /** Named on the row so a workspace-wide gallery can say where each image lives. */
  projectName: string;
  product?: StudioProductIdentity;
  batchId?: string;
  headline?: StudioAdHeadline;
  settings: unknown;
  rootId: string;
  parentId: string | null;
  version: number;
  prompt: string;
  model: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
  mediaType: "IMAGE" | "VIDEO";
  durationSeconds: number | null;
  video: VideoSettingsView | null;
  createdAt: Date;
  jobId: string;
}

const assetSelect = {
  id: true,
  projectId: true,
  project: { select: { name: true } },
  settings: true,
  rootId: true,
  parentId: true,
  version: true,
  prompt: true,
  model: true,
  width: true,
  height: true,
  bytes: true,
  contentType: true,
  mediaType: true,
  durationSeconds: true,
  createdAt: true,
  jobId: true,
  headline: { select: { text: true, revision: true } },
  job: {
    select: {
      productId: true,
      productName: true,
      batchId: true,
      batchSlot: { select: { batchId: true } },
    },
  },
} as const;

function productView(job: {
  productId?: string | null;
  productName?: string | null;
}): { product?: StudioProductIdentity } {
  return job.productId && job.productName
    ? { product: { id: job.productId, name: job.productName } }
    : {};
}

function toAssetView({
  headline,
  job,
  project,
  ...asset
}: Prisma.ProjectImageAssetGetPayload<{
  select: typeof assetSelect;
}>): AssetView {
  const batchId = job.batchId ?? job.batchSlot?.batchId;
  return {
    ...asset,
    ...productView(job),
    ...(batchId ? { batchId } : {}),
    ...(headline ? { headline } : {}),
    ...splitVideoSettings(asset.mediaType === "VIDEO", asset.settings),
    projectName: project.name,
    ...emptyStudioAssetRating(),
  };
}

export interface VideoSettingsView {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
}

/**
 * A video row's settings, split into the image-shaped `settings` every client
 * already reads and the `video` block that is the truth for it. Without the
 * split a video's `768P` would fail the image resolution enum and take the whole
 * gallery response down.
 */
export function splitVideoSettings(
  isVideo: boolean,
  settings: unknown,
): { settings: unknown; video: VideoSettingsView | null } {
  if (!isVideo) return { settings, video: null };
  const raw =
    typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  // Empty for an animated image, whose frame is the still's own.
  const aspectRatio =
    typeof raw.aspectRatio === "string" ? raw.aspectRatio : "";
  return {
    settings: aspectRatio ? { aspectRatio } : {},
    video: {
      aspectRatio,
      durationSeconds:
        typeof raw.durationSeconds === "number" ? raw.durationSeconds : 5,
      resolution: typeof raw.resolution === "string" ? raw.resolution : "",
    },
  };
}

/**
 * Where a listing reads from: one project, or every project in the workspace.
 *
 * `projectId: null` is the workspace-wide view. Access is re-derived either
 * way; membership of the workspace is what grants every project in it.
 */
interface ListScope {
  projectId: string | null;
  workspaceId: string;
  userId: string;
}

interface ListAssetOptions extends ListScope {
  limit: number;
  /** Return versions older than this cursor instead of the newest page. */
  before?: { createdAt: Date; id: string };
  /** Always include this version, whatever its age. */
  pinnedAssetId?: string;
  sort?: "newest" | "best";
}

async function applyRatings(assets: AssetView[], userId: string) {
  const ratings = await getStudioAssetRatings(
    assets.map((asset) => asset.id),
    userId,
  );
  return assets.map((asset) => ({ ...asset, ...ratings.get(asset.id)! }));
}

async function appendPinnedAsset(
  assets: AssetView[],
  options: ListAssetOptions,
  where: Prisma.ProjectImageAssetWhereInput,
) {
  if (
    options.pinnedAssetId &&
    !assets.some((asset) => asset.id === options.pinnedAssetId)
  ) {
    const pinned = await prisma.projectImageAsset.findFirst({
      where: { id: options.pinnedAssetId, ...where },
      select: assetSelect,
    });
    // Appended out of order on purpose: it is not part of this page, it is the
    // version the caller is looking at. The client keys off ids.
    if (pinned) assets.push(toAssetView(pinned));
  }
}

async function listBestAssets(
  options: ListAssetOptions,
  where: Prisma.ProjectImageAssetWhereInput,
) {
  // Rank lightweight ids before hydrating the page: a high-rated older image
  // must be reachable even when it is outside the newest hundred versions.
  const candidates = await prisma.projectImageAsset.findMany({
    where,
    select: { id: true, createdAt: true },
  });
  const ratings = await getStudioAssetRatings(
    candidates.map((asset) => asset.id),
    options.userId,
  );
  candidates.sort(
    (left, right) =>
      ratings.get(right.id)!.score - ratings.get(left.id)!.score ||
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id.localeCompare(left.id),
  );
  const cursorId = options.before?.id;
  const cursorIndex = cursorId
    ? candidates.findIndex((asset) => asset.id === cursorId)
    : -1;
  // A hidden/deleted anchor ends this page chain; restarting would duplicate
  // every already-loaded image. Refreshing starts a fresh ranked list.
  const start = cursorId
    ? cursorIndex === -1
      ? candidates.length
      : cursorIndex + 1
    : 0;
  const page = candidates.slice(start, start + options.limit + 1);
  const hasMore = page.length > options.limit;
  const ids = page.slice(0, options.limit).map((asset) => asset.id);
  const rows =
    ids.length > 0
      ? await prisma.projectImageAsset.findMany({
          where: { ...where, id: { in: ids } },
          select: assetSelect,
        })
      : [];
  const byId = new Map(rows.map((asset) => [asset.id, asset]));
  const assets = ids.flatMap((id) => {
    const asset = byId.get(id);
    return asset ? [{ ...toAssetView(asset), ...ratings.get(id)! }] : [];
  });
  const last = page.slice(0, options.limit).at(-1);
  const nextCursor =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;
  await appendPinnedAsset(assets, options, where);
  return {
    assets: assets.map((asset) => ({ ...asset, ...ratings.get(asset.id)! })),
    nextCursor,
  };
}

async function scopeWhere(scope: ListScope) {
  if (scope.projectId === null) {
    await requireWorkspaceAccess(scope);
    return { project: { workspaceId: scope.workspaceId } };
  }
  await requireProjectAccess({ ...scope, projectId: scope.projectId });
  return { projectId: scope.projectId };
}

/**
 * A page of versions, newest first, plus any version the caller is looking at.
 * `sort: "best"` ranks feedback across the whole scope before paging.
 *
 * The pinned asset matters: a selection is preserved in the URL, and a project
 * past one page of history would otherwise reload to an empty preview because
 * the selected version was not in the newest page. It is fetched by id
 * regardless of age and merged in.
 */
export async function listAssets(options: ListAssetOptions): Promise<{
  assets: AssetView[];
  nextCursor: { createdAt: Date; id: string } | null;
}> {
  const where = { ...(await scopeWhere(options)), hiddenAt: null };
  if (options.sort === "best") return listBestAssets(options, where);

  // Ordered by `(createdAt, id)`, not `createdAt` alone. Two versions settled
  // in the same millisecond are not rare — a webhook and a poll finishing
  // together produce exactly that — and a timestamp-only cursor with a strict
  // `<` steps over every tie.
  const page = await prisma.projectImageAsset.findMany({
    where: {
      ...where,
      ...(options.before
        ? {
            OR: [
              { createdAt: { lt: options.before.createdAt } },
              {
                createdAt: options.before.createdAt,
                id: { lt: options.before.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    select: assetSelect,
  });

  const hasMore = page.length > options.limit;
  const assets = (hasMore ? page.slice(0, options.limit) : page).map(
    toAssetView,
  );

  // Taken from the page itself, before anything is appended. Reading it after
  // appending the pinned version made the next page start just past that
  // version — skipping everything between it and the end of this page.
  const last = assets.at(-1);
  const nextCursor =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;

  await appendPinnedAsset(assets, options, where);

  return { assets: await applyRatings(assets, options.userId), nextCursor };
}

export async function listStudioBatchAssets(options: {
  projectId: string;
  workspaceId: string;
  userId: string;
  batchId: string;
}): Promise<AssetView[]> {
  await requireProjectAccess(options);
  const { projectId, workspaceId, batchId } = options;
  const image = {
    projectId,
    workspaceId,
    mediaType: ProjectImageMediaType.IMAGE,
    hiddenAt: null,
  };
  const readyRevision = { projectId, workspaceId, asset: { is: image } };
  const slots = await prisma.projectImageJob.findMany({
    where: {
      projectId,
      workspaceId,
      batchId,
      OR: [
        { asset: { is: image } },
        { batchRefinements: { some: readyRevision } },
      ],
    },
    take: MAX_STUDIO_BATCH_IMAGES + 1,
    select: {
      asset: { select: assetSelect },
      batchRefinements: {
        where: readyRevision,
        orderBy: { asset: { version: "desc" } },
        take: 1,
        select: { asset: { select: assetSelect } },
      },
    },
  });
  const assets = slots
    .flatMap(({ asset, batchRefinements }) => {
      const latest = batchRefinements[0]?.asset ?? asset;
      return latest &&
        latest.mediaType === ProjectImageMediaType.IMAGE &&
        latest.projectId === projectId
        ? [toAssetView(latest)]
        : [];
    })
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    );
  return applyRatings(assets, options.userId);
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
  return (await applyRatings([toAssetView(asset)], options.userId))[0]!;
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
  /**
   * The browser's `Range` header, passed through. A `<video>` seeks with it,
   * and Safari will not play an mp4 at all from a server that ignores it.
   */
  range?: string;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
  checksum: string;
  mediaType: "IMAGE" | "VIDEO";
  /** Set when the store answered a byte range: the response is then a 206. */
  contentRange: string | null;
}> {
  await requireProjectAccess(options);
  const asset = await prisma.projectImageAsset.findFirst({
    where: { id: options.assetId, projectId: options.projectId },
    select: {
      blobPathname: true,
      contentType: true,
      checksum: true,
      mediaType: true,
    },
  });
  if (!asset) throw notFound("Image not found");

  // Two independent gates, and the feature needs both. `requireProjectAccess`
  // above decides whether *this caller* may have the bytes. `access: "private"`
  // on the studio's own store is what stops everyone who never comes through
  // this route at all: a private object is not served without the token, and
  // the token is server-side only.
  const result = await get(asset.blobPathname, {
    access: "private",
    token: requireStudioBlobToken(),
    // Uncompressed, so `result.blob.size` is the real length (see driveRead).
    headers: {
      "accept-encoding": "identity",
      ...(options.range ? { range: options.range } : {}),
    },
  });
  if (!result || result.statusCode !== 200) {
    throw notFound("Image bytes are no longer available");
  }
  // The store reports a partial answer as an ordinary 200 with a
  // `content-range`, so that header is the one signal it was a range.
  const contentRange = result.headers.get("content-range");
  return {
    stream: result.stream,
    contentType: asset.contentType || result.blob.contentType,
    mediaType: asset.mediaType,
    size: result.blob.size,
    checksum: asset.checksum,
    contentRange,
  };
}

/** Server-internal read used when building a provider reference. */
export async function readAssetBytes(
  blobPathname: string,
): Promise<Uint8Array> {
  const result = await get(blobPathname, {
    access: "private",
    token: requireStudioBlobToken(),
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

export interface JobView {
  id: string;
  projectId: string;
  status: ProjectImageJobStatus;
  kind: string;
  model: string;
  prompt: string;
  templateId?: string;
  creativeDirection?: string;
  variationIndex?: number;
  /** The provider input this job asked for, so a retry can ask for the same. */
  settings: unknown;
  /** A video job's own settings. Null for an image job. */
  video: VideoSettingsView | null;
  /** The versions this job referenced, so a retry keeps all of them. */
  referenceAssetIds: string[];
  referenceFileIds?: string[];
  useProductCutout?: boolean;
  product?: StudioProductIdentity;
  /** One sentence a person can read. Never the provider's own words. */
  error: string | null;
  /**
   * The stable code a client localises. Null for a job that failed before the
   * studio recorded one, and for the one outage case whose own wording is better
   * than any code — a client falls back to `error` for those.
   */
  failureReason: ImageJobFailureReason | null;
  parentAssetId: string | null;
  assetId: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  settledAt: Date | null;
  /** Set once the provider accepted a cancellation request for this job. */
  cancelRequestedAt: Date | null;
  /** True when a retry could buy a second image. */
  retryMayDuplicateCharge: boolean;
  /**
   * What this generation cost. Null until there is an image, because the studio
   * charges on delivery — so a job that failed reads null, having cost nothing.
   */
  credits: number | null;
  /** @deprecated Always false. Nothing is refunded; nothing is taken until success. */
  refunded: boolean;
}

/**
 * One job by id, scoped to the project.
 *
 * Exists so a caller does not have to find a job inside a page of recent ones:
 * an older id is still a real job, and answering "not found" for it is a lie.
 */
export async function getJob(options: {
  jobId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<JobView | null> {
  await requireProjectAccess(options);
  const job = await prisma.projectImageJob.findFirst({
    where: { id: options.jobId, projectId: options.projectId },
    select: {
      id: true,
      projectId: true,
      status: true,
      kind: true,
      model: true,
      prompt: true,
      settings: true,
      referenceAssetIds: true,
      referenceFileIds: true,
      useProductCutout: true,
      productId: true,
      productName: true,
      error: true,
      failureReason: true,
      parentAssetId: true,
      createdAt: true,
      submittedAt: true,
      settledAt: true,
      cancelRequestedAt: true,
      chargedCents: true,
      transactionId: true,
      asset: { select: { id: true } },
      templateId: true,
      creativeDirection: true,
      variationIndex: true,
    },
  });
  return job ? toJobView(job) : null;
}

export async function listJobs(
  options: ListScope & { limit: number },
): Promise<JobView[]> {
  const where = await scopeWhere(options);
  const jobs = await prisma.projectImageJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      projectId: true,
      status: true,
      kind: true,
      model: true,
      prompt: true,
      settings: true,
      referenceAssetIds: true,
      referenceFileIds: true,
      useProductCutout: true,
      productId: true,
      productName: true,
      error: true,
      failureReason: true,
      parentAssetId: true,
      createdAt: true,
      submittedAt: true,
      settledAt: true,
      cancelRequestedAt: true,
      chargedCents: true,
      transactionId: true,
      asset: { select: { id: true } },
      templateId: true,
      creativeDirection: true,
      variationIndex: true,
    },
  });
  return jobs.map(toJobView);
}

export function toJobView(job: {
  id: string;
  projectId: string;
  status: ProjectImageJobStatus;
  kind: string;
  model: string;
  prompt: string;
  templateId?: string | null;
  creativeDirection?: string | null;
  variationIndex?: number | null;
  settings: unknown;
  referenceAssetIds: string[];
  referenceFileIds?: string[];
  useProductCutout?: boolean;
  productId?: string | null;
  productName?: string | null;
  error: string | null;
  failureReason: string | null;
  parentAssetId: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  settledAt: Date | null;
  cancelRequestedAt: Date | null;
  chargedCents: bigint | null;
  transactionId: string | null;
  asset: { id: string } | null;
}): JobView {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    kind: job.kind,
    model: job.model,
    prompt: job.prompt,
    ...(job.templateId ? { templateId: job.templateId } : {}),
    ...(job.creativeDirection
      ? { creativeDirection: job.creativeDirection }
      : {}),
    ...(job.variationIndex != null
      ? { variationIndex: job.variationIndex }
      : {}),
    ...productView(job),
    ...splitVideoSettings(
      job.kind === "TEXT_TO_VIDEO" || job.kind === "IMAGE_TO_VIDEO",
      job.settings,
    ),
    referenceAssetIds: job.referenceAssetIds,
    ...(job.referenceFileIds?.length
      ? { referenceFileIds: job.referenceFileIds }
      : {}),
    ...(job.useProductCutout ? { useProductCutout: true } : {}),
    error: job.error,
    failureReason: readImageJobFailureReason(job.failureReason),
    parentAssetId: job.parentAssetId,
    assetId: job.asset?.id ?? null,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    settledAt: job.settledAt,
    cancelRequestedAt: job.cancelRequestedAt,
    retryMayDuplicateCharge:
      job.status === ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
    // Keyed on the transaction, not on `chargedCents`: before delivery that column
    // holds the *quote*, and reporting a quote as a charge is what made a failed
    // generation read as costing 8 credits when nothing had been taken.
    credits:
      job.transactionId != null && job.chargedCents != null
        ? convertCentsToCredits(job.chargedCents)
        : null,
    refunded: false,
  };
}
