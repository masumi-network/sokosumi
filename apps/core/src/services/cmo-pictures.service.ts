import { ProjectImageJobStatus } from "@sokosumi/database";
import { socialPostPlanningSchema } from "@sokosumi/soko-bot";
import sharp from "sharp";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import prisma from "@/lib/db/prisma";
import {
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";
import {
  CMO_STYLE_PASSED,
  CMO_STYLE_REJECTED,
} from "@/services/cmo-media-maker.service";
import { readAssetBytes } from "@/services/image-studio-assets.service";

/**
 * Every picture Cuso made for his month's posts, for the owner's Settings,
 * Pictures page: grouped by post, the one that went on it, the alternatives
 * that did not (each with the check's verdict) and the tries that failed.
 * Read from Core's own records: the month's image jobs (`cmo-media:` keys),
 * cmo-v11's picks, and the posts.
 */

const KEY_PREFIX = "cmo-media:";
/** Groups on one page, newest first. */
const MAX_GROUPS = 120;
/** Longest edge of an alternative's preview. */
const PREVIEW_PX = 720;

export interface CmoPictureAlternative {
  jobId: string;
  model: string;
  /** passed, rejected (with why), failed (the model made nothing) or waiting. */
  verdict: "passed" | "rejected" | "failed" | "waiting";
  why: string | null;
  chosen: boolean;
  /** The preview's address on this API, for a finished picture. */
  hasImage: boolean;
  createdAt: string;
}

export interface CmoPictureGroup {
  postId: string;
  network: string;
  scheduledAt: string | null;
  headline: string | null;
  title: string | null;
  pictureKind: string | null;
  slot: number;
  /** The picture on the post, with its logo, as the network shows it. */
  postedUrl: string | null;
  /** Why the chosen one won; null before a pick or for one try at a time. */
  reason: string | null;
  alternatives: CmoPictureAlternative[];
}

function verdictOf(job: {
  status: ProjectImageJobStatus;
  error: string | null;
}): Pick<CmoPictureAlternative, "verdict" | "why"> {
  if (job.status === ProjectImageJobStatus.FAILED)
    return { verdict: "failed", why: job.error };
  if (job.status !== ProjectImageJobStatus.SUCCEEDED)
    return { verdict: "waiting", why: null };
  if (job.error?.startsWith(CMO_STYLE_PASSED))
    return { verdict: "passed", why: null };
  if (job.error?.startsWith(CMO_STYLE_REJECTED))
    return {
      verdict: "rejected",
      why: job.error.slice(CMO_STYLE_REJECTED.length) || null,
    };
  return { verdict: "waiting", why: null };
}

/** A model's name, from the endpoint the job ran on. */
function modelLabel(endpoint: string): string {
  if (endpoint.includes("muse-image")) return "Muse Image";
  if (endpoint.includes("mai-image")) return "MAI-Image 2.7";
  if (endpoint.includes("gpt-image")) return "GPT Image 2.6";
  if (endpoint.includes("nano-banana")) return "Nano Banana 2.1";
  return endpoint.split("/")[1] ?? endpoint;
}

/** The month in which a post goes out, as YYYY-MM (UTC). */
function monthOf(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 7) : null;
}

export async function listCmoPictures(
  input: CusoTarget & {
    network?: string;
    month?: string;
    chosenOnly?: boolean;
  },
): Promise<CmoPictureGroup[]> {
  const cuso = await requireCuso(input);
  const jobs = await prisma.projectImageJob.findMany({
    where: {
      projectId: cuso.projectId,
      idempotencyKey: { startsWith: KEY_PREFIX },
      referenceLibraryIds: { isEmpty: false },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      idempotencyKey: true,
      model: true,
      status: true,
      error: true,
      createdAt: true,
      asset: { select: { id: true } },
    },
  });
  // One group per picture slot: strategy, piece, slot and visual.
  const groups = new Map<
    string,
    {
      strategyId: string;
      pieceId: string;
      slot: number;
      visualKey: string;
      jobs: typeof jobs;
    }
  >();
  for (const job of jobs) {
    const [, strategyId, pieceId, slot, step, visualKey] =
      job.idempotencyKey.split(":");
    if (!strategyId || !pieceId || step !== "image" || !visualKey) continue;
    const key = `${strategyId}:${pieceId}:${slot}:${visualKey}`;
    const group = groups.get(key) ?? {
      strategyId,
      pieceId,
      slot: Number(slot),
      visualKey,
      jobs: [],
    };
    group.jobs.push(job);
    groups.set(key, group);
  }
  const pieceIds = [
    ...new Set([...groups.values()].map((group) => group.pieceId)),
  ];
  const [posts, picks] = await Promise.all([
    prisma.socialPost.findMany({
      where: { id: { in: pieceIds }, projectId: cuso.projectId },
      select: {
        id: true,
        provider: true,
        scheduledAt: true,
        planning: true,
        media: true,
      },
    }),
    prisma.cmoPicturePick.findMany({
      where: { projectId: cuso.projectId },
      select: {
        marketingStrategyId: true,
        pieceId: true,
        slot: true,
        visualKey: true,
        chosenJobId: true,
        reason: true,
      },
    }),
  ]);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const result: CmoPictureGroup[] = [];
  for (const group of groups.values()) {
    const post = postById.get(group.pieceId);
    // Only pictures of the month's posts: a piece that became a file or was
    // cancelled has no post to show them under.
    if (!post) continue;
    if (input.network && post.provider !== input.network) continue;
    if (input.month && monthOf(post.scheduledAt) !== input.month) continue;
    const pick = picks.find(
      (row) =>
        row.marketingStrategyId === group.strategyId &&
        row.pieceId === group.pieceId &&
        row.slot === group.slot &&
        row.visualKey === group.visualKey,
    );
    // Before cmo-v11 a slot made one picture at a time: the one that passed.
    const chosenJobId =
      pick?.chosenJobId ??
      group.jobs.findLast((job) => job.error?.startsWith(CMO_STYLE_PASSED))
        ?.id ??
      null;
    if (input.chosenOnly && !chosenJobId) continue;
    const planning = socialPostPlanningSchema.safeParse(post.planning);
    const media = parseSocialPostMedia(post.media, post.id);
    result.push({
      postId: post.id,
      network: post.provider,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      headline: planning.success ? (planning.data.headline ?? null) : null,
      title: planning.success ? (planning.data.title ?? null) : null,
      pictureKind: planning.success
        ? (planning.data.pictureKind ?? null)
        : null,
      slot: group.slot,
      postedUrl: chosenJobId ? (media[group.slot]?.fileUrl ?? null) : null,
      reason: pick?.reason ?? null,
      alternatives: group.jobs.map((job) => ({
        jobId: job.id,
        model: modelLabel(job.model),
        ...verdictOf(job),
        chosen: job.id === chosenJobId,
        hasImage: Boolean(job.asset),
        createdAt: job.createdAt.toISOString(),
      })),
    });
  }
  return result
    .sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""))
    .slice(0, MAX_GROUPS);
}

/** One of Cuso's month pictures as a small JPEG, for the owner's Pictures page. */
export async function readCmoPicturePreview(
  input: CusoTarget & { jobId: string },
): Promise<Buffer> {
  const cuso = await requireCuso(input);
  const job = await prisma.projectImageJob.findFirst({
    where: {
      id: input.jobId,
      projectId: cuso.projectId,
      idempotencyKey: { startsWith: KEY_PREFIX },
    },
    select: { asset: { select: { blobPathname: true } } },
  });
  if (!job?.asset) throw new CmoNotFoundError("No such picture");
  const bytes = await readAssetBytes(job.asset.blobPathname);
  return sharp(bytes)
    .rotate()
    .resize(PREVIEW_PX, PREVIEW_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
