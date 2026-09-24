import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  Channel,
  type Prisma,
  TaskLinkType,
  TaskScheduleRunState,
  TaskStatus,
  type TaskVisibility,
} from "@sokosumi/database";
import type { TaskScheduleMetadata } from "@sokosumi/utils";

export interface TaskScheduleReleaseTemplate {
  id: string;
  ownerId: string;
  organizationId: string | null;
  workspaceId: string;
  projectId: string | null;
  assigneeId: string | null;
  name: string;
  description: string | null;
  visibility: TaskVisibility;
}

export interface TaskScheduleOccurrenceReleaseTimes {
  originalScheduledAt: Date;
  effectiveScheduledAt: Date;
}

function getCloneTaskData(template: TaskScheduleReleaseTemplate) {
  return {
    ownerId: template.ownerId,
    organizationId: template.organizationId,
    workspaceId: template.workspaceId,
    projectId: template.projectId,
    assigneeId: template.assigneeId,
    name: template.name,
    description: template.description,
    visibility: template.visibility,
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
    creatorUserId: template.ownerId,
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    events: {
      create: {
        status: TaskStatus.READY,
        channel: Channel.SOKOSUMI,
        userId: template.ownerId,
      },
    },
  };
}

export async function cloneRecurringTaskScheduleOccurrence(
  tx: Prisma.TransactionClient,
  template: TaskScheduleReleaseTemplate,
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
  times: TaskScheduleOccurrenceReleaseTimes,
  recordCalendarHistory: boolean,
): Promise<string> {
  const clone = await tx.task.create({
    data: getCloneTaskData(template),
    select: { id: true },
  });

  const link = await tx.taskLink.create({
    data: {
      fromTaskId: template.id,
      toTaskId: clone.id,
      type: TaskLinkType.SCHEDULE,
    },
    select: { id: true },
  });

  if (metadata.version === 1) {
    await tx.taskScheduleRun.deleteMany({
      where: {
        seriesTaskId: template.id,
        sourceProjectId: template.projectId,
        scheduleVersion: 1,
        state: TaskScheduleRunState.PLANNED,
        effectiveScheduledAt: times.effectiveScheduledAt,
        ruleSnapshot: { path: ["scheduledAt"], equals: metadata.scheduledAt },
      },
    });
  }

  if (!recordCalendarHistory) {
    return clone.id;
  }

  const source = {
    sourceWorkspaceId: template.workspaceId,
    sourceType: template.projectId
      ? CalendarSourceType.PROJECT
      : CalendarSourceType.WORKSPACE,
    sourceProjectId: template.projectId,
  };

  if (metadata.version === 2) {
    await tx.taskScheduleRun.deleteMany({
      where: {
        seriesTaskId: template.id,
        epochId: metadata.epochId,
        originalScheduledAt: times.originalScheduledAt,
        state: TaskScheduleRunState.PLANNED,
      },
    });
  }

  await tx.taskScheduleRun.create({
    data:
      metadata.version === 1
        ? {
            seriesTaskId: template.id,
            releasedTaskId: clone.id,
            legacyLinkId: link.id,
            scheduleVersion: 1,
            effectiveScheduledAt: times.effectiveScheduledAt,
            state: TaskScheduleRunState.RELEASED,
            ...source,
            sourceAccuracy: CalendarSourceAccuracy.INFERRED,
            timeAccuracy: CalendarTimeAccuracy.APPROXIMATE,
            timezone: metadata.timezone,
            ruleSnapshot: metadata,
          }
        : {
            seriesTaskId: template.id,
            releasedTaskId: clone.id,
            epochId: metadata.epochId,
            scheduleVersion: 2,
            originalScheduledAt: times.originalScheduledAt,
            effectiveScheduledAt: times.effectiveScheduledAt,
            state: TaskScheduleRunState.RELEASED,
            ...source,
            sourceAccuracy: CalendarSourceAccuracy.EXACT,
            timeAccuracy: CalendarTimeAccuracy.EXACT,
            timezone: metadata.timezone,
            ruleSnapshot: metadata,
          },
  });

  return clone.id;
}
