import { NoticeKind, type Prisma } from "@sokosumi/database";
import { buildNoticeTemplate, parseNoticeTemplate } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";

export interface AnnouncementDraft {
  title: string;
  summary: string;
  body: string;
  coverUrl: string | null;
  action: { label: string; path: string } | null;
}

export interface Announcement extends AnnouncementDraft {
  announcementId: string;
  live: boolean;
  closedBy: number;
  updatedAt: string;
}

type Client = Prisma.TransactionClient | typeof prisma;

function toAnnouncement(notice: {
  id: string;
  isActive: boolean;
  bodyMarkdown: string;
  updatedAt: Date;
  _count: { acknowledgments: number };
}): Announcement {
  const { header, bodyMarkdown } = parseNoticeTemplate(notice.bodyMarkdown);
  return {
    announcementId: notice.id,
    live: notice.isActive,
    title: header.title ?? "",
    summary: header.summary ?? "",
    body: bodyMarkdown.trim(),
    coverUrl: header.cover ?? null,
    action:
      header.actionLabel && header.actionUrl
        ? { label: header.actionLabel, path: header.actionUrl }
        : null,
    closedBy: notice._count.acknowledgments,
    updatedAt: notice.updatedAt.toISOString(),
  };
}

const ANNOUNCEMENT_SELECT = {
  id: true,
  isActive: true,
  bodyMarkdown: true,
  updatedAt: true,
  _count: { select: { acknowledgments: true } },
} as const;

export async function listAnnouncements(limit = 20): Promise<Announcement[]> {
  const notices = await prisma.notice.findMany({
    where: { kind: NoticeKind.ANNOUNCEMENT },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: ANNOUNCEMENT_SELECT,
  });
  return notices.map(toAnnouncement);
}

function announcementWhere(announcementId: string) {
  return { id: announcementId, kind: NoticeKind.ANNOUNCEMENT };
}

/**
 * Creates a draft, or rewrites one that is not live. `coverUrl` undefined
 * keeps an existing draft's cover. Returns null for an unknown id and
 * "live" for one users can see right now.
 */
export async function saveAnnouncementDraft(
  client: Client,
  announcementId: string | undefined,
  draft: Omit<AnnouncementDraft, "coverUrl"> & { coverUrl?: string },
): Promise<Announcement | null | "live"> {
  const existing = announcementId
    ? await client.notice.findFirst({
        where: announcementWhere(announcementId),
        select: { isActive: true, bodyMarkdown: true },
      })
    : null;
  if (announcementId && !existing) return null;
  if (existing?.isActive) return "live";
  const cover =
    draft.coverUrl ??
    (existing ? parseNoticeTemplate(existing.bodyMarkdown).header.cover : null);
  const bodyMarkdown = buildNoticeTemplate(
    {
      title: draft.title,
      summary: draft.summary,
      cover: cover ?? undefined,
      actionLabel: draft.action?.label,
      actionUrl: draft.action?.path,
    },
    draft.body,
  );
  const notice = announcementId
    ? await client.notice.update({
        where: { id: announcementId },
        data: { bodyMarkdown },
        select: ANNOUNCEMENT_SELECT,
      })
    : await client.notice.create({
        data: { kind: NoticeKind.ANNOUNCEMENT, bodyMarkdown, isActive: false },
        select: ANNOUNCEMENT_SELECT,
      });
  return toAnnouncement(notice);
}

/**
 * Shows an announcement to everyone who signed up before now, or ends it.
 * Returns null for an unknown id.
 */
export async function setAnnouncementLive(
  client: Client,
  announcementId: string,
  live: boolean,
): Promise<Announcement | null> {
  const existing = await client.notice.findFirst({
    where: announcementWhere(announcementId),
    select: { id: true },
  });
  if (!existing) return null;
  const notice = await client.notice.update({
    where: { id: announcementId },
    data: live
      ? { isActive: true, effectiveAt: new Date() }
      : { isActive: false },
    select: ANNOUNCEMENT_SELECT,
  });
  return toAnnouncement(notice);
}
