import { CalendarSourceType, NewsletterIssueStatus } from "@sokosumi/database";

import { getCalendarSourceId } from "@/helpers/calendar-source";
import prisma from "@/lib/db/prisma";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import { newsletterIssueCalendarItemSchema } from "@/schemas/workspace-calendar.schema";

import {
  type CalendarReader,
  NO_ENTRIES,
  pageInMemory,
} from "./read-shared.js";

/** Newsletter issues at their scheduled time, else their sent time. */
export const readNewsletter: CalendarReader = async (ctx) => {
  const { workspaceId, userId, query, options } = ctx;
  if (!(await isNewsletterWorkspaceEnabled(workspaceId))) {
    return NO_ENTRIES;
  }
  const range = { gte: query.from, lt: query.to };
  const issues = await prisma.newsletterIssue.findMany({
    where: {
      workspaceId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(query.scope === "owned" ? { creatorUserId: userId } : {}),
      status: query.agendaOnly
        ? {
            in: [
              NewsletterIssueStatus.NEEDS_APPROVAL,
              NewsletterIssueStatus.SCHEDULED,
              NewsletterIssueStatus.SENDING,
            ],
          }
        : {
            notIn: [
              NewsletterIssueStatus.DRAFT,
              NewsletterIssueStatus.CANCELED,
            ],
          },
      OR: [{ scheduledAt: range }, { scheduledAt: null, sentAt: range }],
    },
    select: {
      id: true,
      subject: true,
      status: true,
      scheduledAt: true,
      sentAt: true,
      projectId: true,
      workspaceId: true,
      project: { select: { name: true } },
    },
  });
  return pageInMemory(
    issues.flatMap((issue) => {
      const scheduledAt = issue.scheduledAt ?? issue.sentAt;
      return scheduledAt
        ? [
            newsletterIssueCalendarItemSchema.parse({
              kind: "newsletterIssue",
              id: `newsletter:${issue.id}`,
              scheduledAt: scheduledAt.toISOString(),
              issueId: issue.id,
              subject: issue.subject,
              status: issue.status,
              projectName: issue.project.name,
              sourceId: getCalendarSourceId({
                sourceWorkspaceId: issue.workspaceId,
                sourceType: CalendarSourceType.PROJECT,
                sourceProjectId: issue.projectId,
              }),
              sourceProjectId: issue.projectId,
              sourceWorkspaceId: issue.workspaceId,
              sourceType: CalendarSourceType.PROJECT,
            }),
          ]
        : [];
    }),
    ctx,
  );
};
