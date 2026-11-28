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

/** Newest first; one read per Task follows, so the list stays short. */
const RESULTS_LIMIT = 50;

export interface ProjectResult {
  id: string;
  name: string;
  identifier: string | null;
  finishedAt: string;
  result: string;
}

interface LoadProjectResultsParameters extends AuthenticatedRequest {
  projectId: string;
}

/**
 * The Project's done Tasks that have a result, each with its newest done
 * comment. Core lists only Tasks the reader may see, and each Task is read
 * again as the reader, so the document holds nothing the Task pages hide.
 */
export const loadProjectResults = withSession<
  LoadProjectResultsParameters,
  ActionResultDto<ProjectResult[], ActionError>
>(async ({ projectId }) => {
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));

  let loaded: Result<ProjectResult[], ActionError>;
  try {
    const { tasks } = await taskService.listTasks({
      projectId,
      status: "COMPLETED",
      scope: "workspace",
      sort: "updatedAt",
      limit: RESULTS_LIMIT,
    });
    const details = await Promise.all(
      tasks.map(({ id }) => taskService.getTaskById(id)),
    );
    loaded = ok(
      details.flatMap((task) => {
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
            result: result.comment,
          },
        ];
      }),
    );
  } catch (error) {
    console.error("Failed to load Project results", error);
    loaded = err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR });
  }
  return toActionResult(loaded);
});
