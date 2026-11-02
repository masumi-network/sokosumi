import { CalendarSourceType, FileResourceLifecycle } from "@sokosumi/database";

import { getCalendarSourceId } from "@/helpers/calendar-source";
import prisma from "@/lib/db/prisma";
import { marketingPieceCalendarItemSchema } from "@/schemas/workspace-calendar.schema";
import {
  parseMarketingPlan,
  plannedAt,
  planTimeZones,
  socialPostProvider,
} from "@/services/marketing-strategy.service";

import { type CalendarReader, pageInMemory } from "./read-shared.js";

const AGENDA_STATUSES = ["idea", "draft", "scheduled"];

/**
 * The approved Marketing strategy's pieces that are not Social posts (ADR
 * 0062), at the plan's date and time in the Project's time zone. A plan
 * holds at most 120 entries, so range and cursor are applied in memory.
 */
export const readMarketing: CalendarReader = async (ctx) => {
  const { workspaceId, query, options } = ctx;
  const strategies = await prisma.marketingStrategy.findMany({
    where: {
      approvedAt: { not: null },
      project: {
        workspaceId,
        ...(options.projectId ? { id: options.projectId } : {}),
      },
    },
    select: {
      id: true,
      projectId: true,
      plan: true,
      project: { select: { name: true } },
    },
  });
  const [zones, files] = await Promise.all([
    planTimeZones(strategies.map((strategy) => strategy.projectId)),
    prisma.marketingStrategyFile.findMany({
      where: {
        marketingStrategyId: { in: strategies.map((strategy) => strategy.id) },
        fileResource: { lifecycle: FileResourceLifecycle.ACTIVE },
      },
      select: {
        marketingStrategyId: true,
        entryId: true,
        fileResourceId: true,
      },
    }),
  ]);
  const fileIds = new Map(
    files.map((file) => [
      `${file.marketingStrategyId}:${file.entryId}`,
      file.fileResourceId,
    ]),
  );
  return pageInMemory(
    strategies.flatMap((strategy) => {
      const timeZone = zones.get(strategy.projectId) ?? "UTC";
      return (parseMarketingPlan(strategy.plan)?.calendar ?? []).flatMap(
        (entry) => {
          const scheduledAt = plannedAt(entry, timeZone);
          if (
            !scheduledAt ||
            scheduledAt < query.from ||
            scheduledAt >= query.to ||
            entry.socialPostId ||
            socialPostProvider(entry.channel) ||
            entry.status === "skipped" ||
            (query.agendaOnly && !AGENDA_STATUSES.includes(entry.status))
          ) {
            return [];
          }
          return [
            marketingPieceCalendarItemSchema.parse({
              kind: "marketingPiece",
              id: `marketing:${strategy.id}:${entry.id}`,
              scheduledAt: scheduledAt.toISOString(),
              strategyId: strategy.id,
              entryId: entry.id,
              title: entry.title,
              channel: entry.channel,
              format: entry.format,
              status: entry.status,
              // Only a file that still exists; the entry's own fileId can outlive it.
              fileId: fileIds.get(`${strategy.id}:${entry.id}`) ?? null,
              projectName: strategy.project.name,
              sourceId: getCalendarSourceId({
                sourceWorkspaceId: workspaceId,
                sourceType: CalendarSourceType.PROJECT,
                sourceProjectId: strategy.projectId,
              }),
              sourceProjectId: strategy.projectId,
              sourceWorkspaceId: workspaceId,
              sourceType: CalendarSourceType.PROJECT,
            }),
          ];
        },
      );
    }),
    ctx,
  );
};
