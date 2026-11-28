"use server";

import { err, ok, type Result } from "neverthrow";
import * as z from "zod";

import { latestResult } from "@/app/projects/components/project-results-model";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const PAGE_SIZE = 100;
/** Task reads in flight at once, so a large Project does not flood Core. */
const READS_AT_ONCE = 10;

export interface ProjectResult {
  id: string;
  name: string;
  identifier: string | null;
  finishedAt: string;
  /** Who wrote the result: a Coworker, a person or a Soko Bot. */
  by: string | null;
  result: string;
}

async function listCompletedTaskIds(projectId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const { tasks, pagination } = await taskService.listTasks({
      projectId,
      status: "COMPLETED",
      scope: "workspace",
      includeSubtasks: true,
      sort: "createdAt",
      limit: PAGE_SIZE,
      cursor,
    });
    // A result is a done comment, so a Task with no comment has none to read.
    ids.push(
      ...tasks
        .filter(({ commentsCount }) => commentsCount > 0)
        .map(({ id }) => id),
    );
    cursor = pagination?.nextCursor ?? null;
  } while (cursor);
  return ids;
}

async function readTasks(ids: string[]) {
  const tasks = [];
  for (let start = 0; start < ids.length; start += READS_AT_ONCE)
    tasks.push(
      ...(await Promise.all(
        ids
          .slice(start, start + READS_AT_ONCE)
          .map((id) => taskService.getReadableTask(id)),
      )),
    );
  return tasks;
}

interface LoadProjectResultsParameters extends AuthenticatedRequest {
  projectId: string;
}

/**
 * The Project's done Tasks that have a result, each with its newest done
 * comment, oldest first so the document reads in the order the work
 * finished. Core lists only Tasks the reader may see, and each Task is read
 * again as the reader, so the document holds nothing the Task pages hide. A
 * Task that is gone or hidden is left out; any other failed read fails the
 * whole list, so the reader never gets a file with results silently missing.
 */
export const loadProjectResults = withSession<
  LoadProjectResultsParameters,
  ActionResultDto<ProjectResult[], ActionError>
>(async ({ projectId }) => {
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));

  let loaded: Result<ProjectResult[], ActionError>;
  try {
    const details = await readTasks(await listCompletedTaskIds(projectId));
    loaded = ok(
      details
        .flatMap((task) => {
          if (
            !task ||
            task.projectId !== projectId ||
            task.status !== "COMPLETED"
          )
            return [];
          const result = latestResult(task.events);
          if (!result) return [];
          return [
            {
              id: task.id,
              name: task.name,
              identifier: task.identifier,
              finishedAt: result.createdAt,
              by: result.by,
              result: result.comment,
            },
          ];
        })
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt)),
    );
  } catch (error) {
    console.error("Failed to load Project results", error);
    loaded = err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR });
  }
  return toActionResult(loaded);
});
