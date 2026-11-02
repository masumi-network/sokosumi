import { CalendarSourceType } from "@sokosumi/database";

import { getCalendarSourceId } from "@/helpers/calendar-source";
import {
  toLocalDateKey,
  zonedDateTimeLocalToUtc,
} from "@/helpers/task-schedule";
import prisma from "@/lib/db/prisma";
import { contactFollowUpCalendarItemSchema } from "@/schemas/workspace-calendar.schema";

import { type CalendarReader, pageInMemory } from "./read-shared.js";

/**
 * Contact follow-ups, all-day, on every day the range touches in the
 * caller's time zone. Each sits at the start of its day.
 */
export const readContacts: CalendarReader = async (ctx) => {
  const { workspaceId, userId, query } = ctx;
  const timeZone = query.timeZone ?? "UTC";
  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      followUpAt: {
        gte: new Date(toLocalDateKey(query.from, timeZone)),
        lte: new Date(
          toLocalDateKey(new Date(query.to.getTime() - 1), timeZone),
        ),
      },
      ...(query.scope === "owned" ? { createdByUserId: userId } : {}),
    },
    select: {
      id: true,
      name: true,
      organization: true,
      avatarUrl: true,
      nextStep: true,
      followUpAt: true,
      workspaceId: true,
    },
  });
  return pageInMemory(
    contacts.flatMap(({ followUpAt, ...contact }) => {
      const date = followUpAt?.toISOString().slice(0, 10);
      const scheduledAt =
        date && zonedDateTimeLocalToUtc(`${date}T00:00`, timeZone);
      return scheduledAt
        ? [
            contactFollowUpCalendarItemSchema.parse({
              kind: "contactFollowUp",
              id: `followup:${contact.id}`,
              scheduledAt: scheduledAt.toISOString(),
              contactId: contact.id,
              name: contact.name,
              organization: contact.organization,
              avatarUrl: contact.avatarUrl,
              nextStep: contact.nextStep,
              date,
              allDay: true,
              sourceId: getCalendarSourceId({
                sourceWorkspaceId: contact.workspaceId,
                sourceType: CalendarSourceType.WORKSPACE,
                sourceProjectId: null,
              }),
              sourceProjectId: null,
              sourceWorkspaceId: contact.workspaceId,
              sourceType: CalendarSourceType.WORKSPACE,
            }),
          ]
        : [];
    }),
    ctx,
  );
};
