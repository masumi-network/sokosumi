import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { newsletterIssueCalendarItemSchema } from "@/schemas/workspace-calendar.schema";
import type { WorkspaceCalendarReadQuery } from "./read";

export function scheduledNewsletterIssueWhere(
  workspaceId: string,
  userId: string,
  scope: "owned" | "workspace",
  projectId?: string,
): Prisma.NewsletterIssueWhereInput {
  return {
    workspaceId,
    project: { workspaceId },
    ...(projectId ? { projectId } : {}),
    ...(scope === "owned" ? { approvedByUserId: userId } : {}),
    status: { in: ["SCHEDULED", "SENDING"] },
  };
}

/** A separate, bounded stream for issues whose only calendar time is sentAt. */
export async function readNewsletterCalendar(
  workspaceId: string,
  userId: string,
  query: WorkspaceCalendarReadQuery,
  projectId?: string,
) {
  const base = scheduledNewsletterIssueWhere(
    workspaceId,
    userId,
    query.scope,
    projectId,
  );
  const streams: {
    field: "scheduledAt" | "sentAt";
    where: Prisma.NewsletterIssueWhereInput;
  }[] = [
    {
      field: "scheduledAt",
      where: {
        ...base,
        status: {
          in: query.agendaOnly
            ? ["SCHEDULED", "SENDING"]
            : ["SCHEDULED", "SENDING", "SENT"],
        },
        scheduledAt: { gte: query.from, lt: query.to },
      },
    },
    ...(!query.agendaOnly
      ? [
          {
            field: "sentAt" as const,
            where: {
              ...base,
              status: "SENT" as const,
              scheduledAt: null,
              sentAt: { gte: query.from, lt: query.to },
            },
          },
        ]
      : []),
  ];
  const pages = await Promise.all(
    streams.map(async ({ field, where }) => {
      const cursor = query.cursor;
      const cursorWhere: Prisma.NewsletterIssueWhereInput = cursor
        ? {
            OR: [
              { [field]: { gt: new Date(cursor.scheduledAt) } },
              ...(cursor.id.startsWith("newsletter:")
                ? [
                    {
                      [field]: new Date(cursor.scheduledAt),
                      id: { gt: cursor.id.slice(11) },
                    },
                  ]
                : "newsletter:" > cursor.id
                  ? [{ [field]: new Date(cursor.scheduledAt) }]
                  : []),
            ],
          }
        : {};
      const [issues, total] = await Promise.all([
        prisma.newsletterIssue.findMany({
          where: { AND: [where, cursorWhere] },
          take: query.limit + 1,
          orderBy: [{ [field]: "asc" }, { id: "asc" }],
          select: {
            id: true,
            subject: true,
            status: true,
            scheduledAt: true,
            sentAt: true,
            projectId: true,
            workspaceId: true,
          },
        }),
        prisma.newsletterIssue.count({ where }),
      ]);
      return {
        total,
        items: issues.map((issue) =>
          newsletterIssueCalendarItemSchema.parse({
            kind: "newsletter_issue",
            id: `newsletter:${issue.id}`,
            issueId: issue.id,
            subject: issue.subject,
            status: issue.status,
            scheduledAt: issue[field],
            sourceId: `project:${issue.projectId}`,
            sourceProjectId: issue.projectId,
            sourceWorkspaceId: issue.workspaceId,
            sourceType: "PROJECT",
          }),
        ),
      };
    }),
  );
  return {
    items: pages.flatMap((page) => page.items),
    total: pages.reduce((sum, page) => sum + page.total, 0),
  };
}
