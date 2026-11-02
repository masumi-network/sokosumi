import { type Prisma, SocialPostStatus } from "@sokosumi/database";

import { parseSocialPostMedia } from "@/helpers/social-post-media";
import { isSocialPostWaitingForQuote } from "@/helpers/social-post-quote";
import { summarizeSocialPostThread } from "@/helpers/social-post-thread";
import prisma from "@/lib/db/prisma";
import { socialPostCalendarItemSchema } from "@/schemas/workspace-calendar.schema";

import { type CalendarReader, idFilterAtCursorTime } from "./read-shared.js";

export const readSocial: CalendarReader = async ({
  workspaceId,
  userId,
  query,
  options,
}) => {
  const { cursor, from, to } = query;
  const maxCandidates = query.limit + 1;
  const socialBaseWhere: Prisma.SocialPostWhereInput = {
    workspaceId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(query.scope === "owned" ? { scheduledByUserId: userId } : {}),
    // The agenda view shows only what is still to come: a scheduled,
    // needs-approval, or publishing post whose `scheduledAt` is today or later
    // (the `from` bound below). Everything else is history the agenda would
    // filter out anyway.
    ...(query.agendaOnly
      ? {
          status: {
            in: [
              SocialPostStatus.NEEDS_APPROVAL,
              SocialPostStatus.SCHEDULED,
              SocialPostStatus.PUBLISHING,
            ],
          },
        }
      : { status: { not: "DRAFT" } }),
    scheduledAt: { gte: from, lt: to },
  };
  const atCursorTime = cursor && idFilterAtCursorTime("social:", cursor);
  const socialCursor: Prisma.SocialPostWhereInput = cursor
    ? {
        OR: [
          { scheduledAt: { gt: new Date(cursor.scheduledAt) } },
          ...(atCursorTime
            ? [{ scheduledAt: new Date(cursor.scheduledAt), ...atCursorTime }]
            : []),
        ],
      }
    : {};
  const [posts, postCount] = await Promise.all([
    prisma.socialPost.findMany({
      where: { ...socialBaseWhere, ...socialCursor },
      take: maxCandidates,
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        provider: true,
        text: true,
        status: true,
        revision: true,
        publishedExternalId: true,
        quotedPostId: true,
        quotedPost: { select: { status: true, publishedExternalId: true } },
        needsAttentionReason: true,
        publishingThreadPartPosition: true,
        lastError: true,
        threadParts: {
          orderBy: { position: "asc" },
          select: { position: true, externalPostId: true, error: true },
        },
        scheduledAt: true,
        projectId: true,
        workspaceId: true,
        socialConnection: {
          select: { externalHandle: true, avatarUrl: true },
        },
        project: { select: { name: true } },
        scheduledByUser: { select: { name: true, image: true } },
        attempts: {
          orderBy: { attempt: "desc" },
          take: 1,
          select: { outcome: true, errorKind: true },
        },
        // `media: true` returns the whole Json blob just to count its refs.
        // Prisma cannot project `json_array_length(media)` into this select,
        // so the payload is the price of a single bounded query per page
        // (limit + 1 posts) rather than an N+1 per-post count.
        media: true,
      },
    }),
    prisma.socialPost.count({ where: socialBaseWhere }),
  ]);
  const socialItems = posts.map((post) => {
    const media = parseSocialPostMedia(post.media, post.id);
    return socialPostCalendarItemSchema.parse({
      kind: "socialPost",
      id: `social:${post.id}`,
      postId: post.id,
      quotedPostId: post.quotedPostId,
      needsAttentionReason: post.needsAttentionReason,
      waitingForQuotedPost: isSocialPostWaitingForQuote(
        post,
        post.quotedPost,
        new Date(),
      ),
      ...summarizeSocialPostThread(post),
      provider: post.provider,
      text: post.text,
      status: post.status,
      revision: post.revision,
      externalHandle: post.socialConnection?.externalHandle ?? null,
      avatarUrl: post.socialConnection?.avatarUrl ?? null,
      projectName: post.project.name,
      scheduledByName: post.scheduledByUser?.name ?? null,
      scheduledByImage: post.scheduledByUser?.image ?? null,
      attachmentCount: media.length,
      previewMedia: media[0]
        ? { fileUrl: media[0].fileUrl, kind: media[0].kind }
        : null,
      scheduledAt: post.scheduledAt?.toISOString(),
      lastAttempt: post.attempts[0]
        ? {
            outcome: post.attempts[0].outcome,
            errorKind: post.attempts[0].errorKind,
          }
        : null,
      sourceId: `project:${post.projectId}`,
      sourceProjectId: post.projectId,
      sourceWorkspaceId: post.workspaceId,
      sourceType: "PROJECT",
    });
  });
  return { items: socialItems, total: postCount };
};
