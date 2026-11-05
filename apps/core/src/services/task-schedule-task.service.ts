import * as Sentry from "@sentry/node";
import {
  Channel,
  type Prisma,
  type TaskSchedule,
  TaskStatus,
} from "@sokosumi/database";
import { taskCreationEvents } from "@/helpers/task-creation-events";
import { notifyTaskHumanAssignee } from "@/helpers/task-notifications";
import { publishTaskEventData } from "@/lib/ably/publish";
import { releaseSeoMonitorRun } from "./project-seo-monitor.service";
import type { ReleasedTask } from "./task-schedule-runs.service";

export async function createTaskFromBlueprint(
  tx: Prisma.TransactionClient,
  schedule: TaskSchedule,
  runId: string,
) {
  const seoTask = await releaseSeoMonitorRun(tx, schedule, runId);
  if (seoTask) return seoTask;
  return tx.task.create({
    data: {
      scheduleId: schedule.id,
      ownerId: schedule.ownerId,
      organizationId: schedule.organizationId,
      workspaceId: schedule.workspaceId,
      projectId: schedule.projectId,
      name: schedule.name,
      description: schedule.description,
      visibility: schedule.visibility,
      assigneeId: schedule.assigneeId,
      assigneeSokoBotId: schedule.assigneeSokoBotId,
      assigneeUserId: schedule.assigneeUserId,
      creatorUserId: schedule.creatorUserId,
      creatorCoworkerId: schedule.creatorCoworkerId,
      creatorSokoBotId: schedule.creatorSokoBotId,
      status: TaskStatus.READY,
      events: {
        create: taskCreationEvents({
          status: TaskStatus.READY,
          channel: Channel.SOKOSUMI,
          actorFields: {
            userId: schedule.creatorUserId,
            coworkerId: schedule.creatorCoworkerId,
            sokoBotId: schedule.creatorSokoBotId,
          },
        }),
      },
    },
    select: { id: true, ownerId: true, assigneeUserId: true },
  });
}

export async function announceReleasedTasks(
  tasks: ReleasedTask[],
): Promise<void> {
  await Promise.all(
    tasks.map(async (task) => {
      const ownerId = task.ownerId;
      if (ownerId) {
        try {
          await publishTaskEventData({
            userId: ownerId,
            taskId: task.id,
            eventType: "task_event",
          });
        } catch (error) {
          Sentry.captureException(error, {
            tags: { error_type: "publish_task_event" },
            extra: { taskId: task.id, source: "task-schedule-release" },
          });
        }
      }
      if (task.assigneeUserId) {
        await notifyTaskHumanAssignee(task.id, task.assigneeUserId);
      }
    }),
  );
}
