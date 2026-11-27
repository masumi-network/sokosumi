import type { Prisma } from "@sokosumi/database";
import {
  CMO_OWNER_CONFIRMED_CHANNELS,
  SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
} from "@sokosumi/utils";
import { z } from "zod";

import type { TikTokPostSettings } from "@/clients/social-post-providers/types";
import { getZernioTikTokCreatorInfo } from "@/clients/social-post-providers/zernio-tiktok";
import { getZernioAccountId } from "@/clients/zernio.client";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import prisma from "@/lib/db/prisma";
import { publicDriveUrl } from "@/lib/drive-blob";
import {
  EVAL_TIKTOK_CREATOR_INFO,
  isEvalSocialAccount,
} from "@/lib/evals/eval-social-account";
import {
  CmoConflictError,
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";
import { loadLiveResources } from "@/services/file-search.service";
import {
  isTestCopyProject,
  scheduleLeadMs,
  TEST_COPY_NOTHING_AT_ONCE,
} from "@/services/project-test-copy";
import {
  approveSocialPost,
  cancelSocialPost,
  getSocialPost,
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";

export interface CmoMediaItem {
  kind: "image" | "video";
  url: string;
  name: string;
}

/** A Social post Cuso made outside the month, as CMO shows it. */
export interface CmoDraft {
  id: string;
  provider: string;
  text: string;
  /** Core's Social post status; `NEEDS_APPROVAL` waits for the owner. */
  status: string;
  revision: number;
  scheduledAt: Date | null;
  publishedUrl: string | null;
  media: CmoMediaItem[];
}

/** What a report's turn made: its card shows it under the report. */
export interface CmoReportAttachments {
  posts: CmoDraft[];
  /** Pictures and videos the turn made that are on none of its posts. */
  media: CmoMediaItem[];
}

const DRAFT_SELECT = {
  id: true,
  provider: true,
  text: true,
  status: true,
  revision: true,
  scheduledAt: true,
  publishedUrl: true,
  media: true,
} satisfies Prisma.SocialPostSelect;

type DraftRow = Prisma.SocialPostGetPayload<{ select: typeof DRAFT_SELECT }>;

function toDraft(row: DraftRow): CmoDraft {
  return {
    id: row.id,
    provider: row.provider,
    text: row.text,
    status: row.status,
    revision: row.revision,
    scheduledAt: row.scheduledAt,
    publishedUrl: row.publishedUrl,
    media: parseSocialPostMedia(row.media, row.id).map((file) => ({
      kind: file.kind === "video" ? "video" : "image",
      url: file.fileUrl,
      name: file.name,
    })),
  };
}

/** Most drafts the Calendar lists as waiting. */
const CMO_DRAFTS_SHOWN = 20;

/**
 * The Project's Social posts that wait for the owner, newest first: what Cuso
 * made outside the month, and the month's posts on a network the owner
 * confirms post by post (TikTok).
 */
export async function listCmoDrafts(projectId: string): Promise<CmoDraft[]> {
  const rows = await prisma.socialPost.findMany({
    where: {
      projectId,
      status: "NEEDS_APPROVAL",
      OR: [
        { marketingStrategyId: null },
        { provider: { in: [...CMO_OWNER_CONFIRMED_CHANNELS] } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CMO_DRAFTS_SHOWN,
    select: DRAFT_SELECT,
  });
  return rows.map(toDraft);
}

const MADE_POST = ["create_social_post"];
const DROPPED_POST = ["cancel_social_post"];
const FETCHED_FILE = ["get_video", "get_image"];

const MADE_FILE = z.object({
  status: z.literal("SUCCEEDED"),
  file: z.object({ id: z.string() }),
});

/**
 * What each report's turn made, by report id: the Social posts it created
 * and, when it created none, the pictures and videos it fetched from the
 * studio. Read from the turn's tool calls, so Cuso need not attach anything.
 * A turn's newest report carries them; `reports` is newest first.
 */
export async function cmoReportAttachments(input: {
  reports: readonly { id: string; turnId: string | null; kind: string }[];
  projectId: string;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}): Promise<Map<string, CmoReportAttachments>> {
  const reportOfTurn = new Map<string, string>();
  for (const report of input.reports) {
    // Making the month is one progress card in CMO, not a report to open.
    if (report.kind === "production") continue;
    if (report.turnId && !reportOfTurn.has(report.turnId))
      reportOfTurn.set(report.turnId, report.id);
  }
  const attachments = new Map<string, CmoReportAttachments>();
  if (reportOfTurn.size === 0) return attachments;
  const calls = await prisma.sokoBotToolCall.findMany({
    where: {
      turnId: { in: [...reportOfTurn.keys()] },
      status: "COMPLETED",
      capability: { in: [...MADE_POST, ...DROPPED_POST, ...FETCHED_FILE] },
    },
    orderBy: { createdAt: "asc" },
    select: { turnId: true, capability: true, targetId: true, result: true },
  });
  const targets = (capabilities: string[], turnId?: string) =>
    calls.flatMap((call) =>
      capabilities.includes(call.capability) &&
      call.targetId &&
      (!turnId || call.turnId === turnId)
        ? [call.targetId]
        : [],
    );
  const postIds = targets(MADE_POST);
  const posts = postIds.length
    ? await prisma.socialPost.findMany({
        // A month's post has its place on the Calendar.
        where: {
          id: { in: postIds },
          projectId: input.projectId,
          marketingStrategyId: null,
        },
        select: DRAFT_SELECT,
      })
    : [];
  const fileIdsOf = (turnId: string) => [
    ...new Set(
      calls.flatMap((call) => {
        if (call.turnId !== turnId || !FETCHED_FILE.includes(call.capability))
          return [];
        const made = MADE_FILE.safeParse(call.result);
        return made.success ? [made.data.file.id] : [];
      }),
    ),
  ];
  for (const [turnId, reportId] of reportOfTurn) {
    // A draft Cuso dropped again in the same turn is not the owner's to see.
    const dropped = targets(DROPPED_POST, turnId);
    const made = targets(MADE_POST, turnId)
      .filter((postId) => !dropped.includes(postId))
      .flatMap((postId) => posts.find((post) => post.id === postId) ?? [])
      .map(toDraft);
    const media =
      made.length === 0
        ? await cmoFileMedia({ ...input, fileIds: fileIdsOf(turnId) })
        : [];
    if (made.length > 0 || media.length > 0)
      attachments.set(reportId, { posts: made, media });
  }
  return attachments;
}

/** Files as pictures and videos the member may open, in the order given. */
async function cmoFileMedia(input: {
  fileIds: string[];
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}): Promise<CmoMediaItem[]> {
  if (input.fileIds.length === 0) return [];
  const files = await loadLiveResources({
    workspaceId: input.workspaceId,
    actor: {
      userId: input.userId,
      organizationId: input.organizationId,
      kind: "oauth",
    },
    resourceIds: input.fileIds,
  });
  const media = await Promise.all(
    input.fileIds.map(async (fileId): Promise<CmoMediaItem | null> => {
      const file = files.find((item) => item.id === fileId);
      const mime = file?.mimeType ?? "";
      const kind = mime.startsWith("video/")
        ? "video"
        : mime.startsWith("image/")
          ? "image"
          : null;
      if (!file || !kind) return null;
      const url = await publicDriveUrl(file.sourceId).catch(() => null);
      return url ? { kind, url, name: file.displayName } : null;
    }),
  );
  return media.filter((item): item is CmoMediaItem => item !== null);
}

type DraftTarget = CusoTarget & { postId: string; revision: number };

/** How long after approval a draft without a time goes out. */
export const CMO_APPROVED_POST_DELAY_MS = 2 * 60 * 1_000;

/**
 * The owner approves a draft: it goes out at its planned time, or in two
 * minutes when it has none, so a slip can still be stopped. Refused whole
 * when the network is not connected; the draft then stays as it is.
 */
export async function approveCmoDraft(
  input: DraftTarget & {
    /** The owner's choices and consent for a TikTok video. */
    tikTokSettings?: TikTokPostSettings | undefined;
  },
): Promise<void> {
  const cuso = await requireCuso(input);
  const scope = {
    projectId: cuso.projectId,
    workspaceId: cuso.workspaceId,
    userId: input.userId,
    postId: input.postId,
  };
  let post = await getSocialPost(scope);
  if (post.status !== "NEEDS_APPROVAL")
    throw new CmoConflictError("This post no longer waits for approval.");
  if (post.revision !== input.revision)
    throw new CmoConflictError("This post changed. Look at it again.");
  const testCopy = await isTestCopyProject(cuso.projectId);
  if (post.provider === "tiktok") {
    await postToTikTok(scope, post.revision, testCopy, input.tikTokSettings);
    return;
  }
  const planned =
    post.scheduledAt !== null &&
    post.scheduledAt.getTime() >
      Date.now() +
        scheduleLeadMs(
          { testCopyOfProjectId: testCopy ? cuso.projectId : null },
          SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
        );
  // Approving a draft without a time sends it two minutes later.
  if (!planned && testCopy) {
    throw new CmoConflictError(
      `${TEST_COPY_NOTHING_AT_ONCE}. Give the post a time at least 12 hours ahead.`,
    );
  }
  if (!planned) {
    post = await scheduleSocialPost({
      ...scope,
      revision: post.revision,
      scheduledAt: new Date(Date.now() + CMO_APPROVED_POST_DELAY_MS),
    });
  }
  await approveSocialPost({ ...scope, revision: post.revision });
}

/**
 * TikTok takes a video only with its creator's consent for that video, so the
 * owner's approval is the post: it goes out now, with the audience and the
 * confirmation they gave. A video TikTok does not take waits again.
 */
async function postToTikTok(
  scope: {
    projectId: string;
    workspaceId: string;
    userId: string;
    postId: string;
  },
  revision: number,
  testCopy: boolean,
  settings: TikTokPostSettings | undefined,
): Promise<void> {
  if (testCopy) throw new CmoConflictError(TEST_COPY_NOTHING_AT_ONCE);
  if (!settings?.previewConsent) {
    throw new CmoConflictError(
      "TikTok needs your confirmation for each video: choose who sees it and confirm the video first.",
    );
  }
  const approved = await approveSocialPost({ ...scope, revision });
  const waitAgain = () =>
    prisma.socialPost.updateMany({
      where: {
        id: scope.postId,
        status: { in: ["DRAFT", "SCHEDULED", "FAILED"] },
      },
      data: { status: "NEEDS_APPROVAL", revision: { increment: 1 } },
    });
  const { publishSocialPostNow } = await import(
    "@/services/social-post-publisher.service"
  );
  let published: Awaited<ReturnType<typeof publishSocialPostNow>>;
  try {
    published = await publishSocialPostNow({
      ...scope,
      revision: approved.revision,
      tikTokSettings: settings,
    });
  } catch (error) {
    await waitAgain();
    throw error;
  }
  if (published.status !== "PUBLISHED" && published.status !== "PUBLISHING") {
    await waitAgain();
    throw new CmoConflictError(
      published.lastError ?? "TikTok did not take the video. Try again.",
    );
  }
}

/**
 * What TikTok allows on the account a waiting video goes to: who it posts as,
 * who may see it, and whether comments, Duet and Stitch can be turned on. The
 * owner chooses from these before they confirm the video.
 */
export async function readCmoTikTokCreator(
  input: Omit<DraftTarget, "revision">,
) {
  const cuso = await requireCuso(input);
  const post = await prisma.socialPost.findFirst({
    where: { id: input.postId, projectId: cuso.projectId, provider: "tiktok" },
    select: {
      socialConnection: {
        select: { status: true, composioConnectedAccountId: true },
      },
    },
  });
  if (!post) throw new CmoNotFoundError("No such TikTok post");
  if (
    post.socialConnection?.status === "active" &&
    isEvalSocialAccount(post.socialConnection.composioConnectedAccountId)
  )
    return { ...EVAL_TIKTOK_CREATOR_INFO };
  const accountId =
    post.socialConnection?.status === "active"
      ? getZernioAccountId(post.socialConnection.composioConnectedAccountId)
      : null;
  if (!accountId) {
    throw new CmoConflictError("Connect TikTok again to post this video.");
  }
  return getZernioTikTokCreatorInfo(accountId);
}

/** The owner turns a draft down, or stops an approved one before it goes out. */
export async function declineCmoDraft(input: DraftTarget): Promise<void> {
  const cuso = await requireCuso(input);
  await cancelSocialPost({
    projectId: cuso.projectId,
    workspaceId: cuso.workspaceId,
    userId: input.userId,
    postId: input.postId,
    revision: input.revision,
  });
}

/** The owner rewrites a draft's words; its picture or video stays. */
export async function editCmoDraft(
  input: DraftTarget & { text: string },
): Promise<void> {
  const cuso = await requireCuso(input);
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: cuso.workspaceId },
    select: { organizationId: true },
  });
  await updateSocialPost({
    projectId: cuso.projectId,
    workspaceId: cuso.workspaceId,
    organizationId: workspace.organizationId,
    userId: input.userId,
    postId: input.postId,
    revision: input.revision,
    text: input.text,
  });
}
