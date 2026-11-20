import "server-only";

import type { CreateTaskContext } from "@sokosumi/core-client";
import { buildAdHocDesignMdPrefix } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import {
  TASK_MUTATION_ERROR_KINDS,
  type TaskMutationErrorKind,
} from "@/lib/utils/task-mutation-error-kinds";
import type { TaskContextSelectionInput } from "./action";

export interface TaskMutationError {
  kind: TaskMutationErrorKind;
}

export type TaskMutationActionResult<T> = ActionResultDto<T, TaskMutationError>;

export function taskMutationSuccess<T>(value: T): TaskMutationActionResult<T> {
  return toActionResult(ok(value));
}

export function taskMutationFailure<T>(
  kind: TaskMutationErrorKind,
): TaskMutationActionResult<T> {
  return toActionResult(err({ kind }));
}

export function toTaskMutationErrorKind(
  error: unknown,
): TaskMutationErrorKind | null {
  if (!(error instanceof CoreApiRequestError)) {
    return null;
  }

  return TASK_MUTATION_ERROR_KINDS.find((kind) => kind === error.kind) ?? null;
}

function isClientCoreApiError(error: unknown): error is CoreApiRequestError {
  return (
    error instanceof CoreApiRequestError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  );
}

export function rethrowTaskActionError(
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
): never {
  console.error(logLabel, error);

  if (isClientCoreApiError(error)) {
    throw error;
  }

  const { message } = toCoreApiActionError(error);
  throw new Error(message ?? fallbackMessage);
}

export function normalizeOptionalProjectId(
  projectId?: string | null,
): string | null | undefined {
  if (typeof projectId === "undefined") {
    return undefined;
  }

  const trimmedProjectId = projectId?.trim();
  return trimmedProjectId ? trimmedProjectId : null;
}

/**
 * A task page can be open at `/tasks/{uuid}`, `/tasks/SOK-12` or the slug URL,
 * so revalidate the route, not one concrete path.
 */
export function revalidateTaskMutationRoutes() {
  revalidatePath("/tasks");
  revalidatePath("/tasks/[taskId]", "page");
}

export function resolveAssigneeWrite(
  assigneeId?: string | null,
  assigneeSokoBotId?: string | null,
  assigneeUserId?: string | null,
): {
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
} {
  const sokoBotId = assigneeSokoBotId?.trim() || null;
  if (sokoBotId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: sokoBotId,
      assigneeUserId: null,
    };
  }

  const userId =
    typeof assigneeUserId === "string" ? assigneeUserId.trim() || null : null;
  if (userId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: userId,
    };
  }

  return {
    assigneeId: assigneeId?.trim() ? assigneeId : null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
  };
}

/**
 * Ad hoc overrides are the only client-supplied DESIGN.md attach path. Keep
 * them limited to https blobs under the caller's own ad hoc prefix before
 * forwarding the URL to Core, which performs its own DESIGN.md URL check.
 */
function resolveDesignMdAttachmentUrl(url: string, userId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Invalid DESIGN.md attachment URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("DESIGN.md attachment URL must use https");
  }

  const expectedPathPrefix = `/${buildAdHocDesignMdPrefix(userId)}`;
  if (!parsed.pathname.startsWith(expectedPathPrefix)) {
    throw new Error("DESIGN.md attachment URL is not valid for this user");
  }

  return parsed.href;
}

export function toCoreTaskContext(
  selection: TaskContextSelectionInput,
  userId: string,
): CreateTaskContext {
  if (!selection.brand.enabled) {
    return {
      brand: false,
      briefing: selection.briefingEnabled,
      memory: selection.contextMdEnabled,
    };
  }

  if (selection.brand.source === "custom") {
    if (!selection.brand.custom) {
      throw new Error("Custom DESIGN.md attachment required");
    }

    const customUrl = selection.brand.custom.url;
    let brandUrl: string;
    try {
      brandUrl = resolveDesignMdAttachmentUrl(customUrl, userId);
    } catch (error) {
      // Edit may still carry a stored DESIGN.md that is not under this user's
      // ad-hoc prefix (stale project/workspace brand). Forward non-adhoc https
      // URLs so Core can grandfather the existing attachment. Foreign ad-hoc
      // prefixes still fail here.
      let pathname = "";
      try {
        const parsed = new URL(customUrl);
        if (parsed.protocol !== "https:") {
          throw new Error("DESIGN.md attachment URL must use https");
        }
        pathname = decodeURIComponent(parsed.pathname);
      } catch (parseError) {
        if (
          parseError instanceof Error &&
          parseError.message === "DESIGN.md attachment URL must use https"
        ) {
          throw parseError;
        }
        throw error;
      }
      if (pathname.startsWith("/design-md/adhoc/")) {
        throw error;
      }
      if (!pathname.startsWith("/design-md/")) {
        throw error;
      }
      brandUrl = customUrl;
    }

    return {
      brand: {
        url: brandUrl,
      },
      briefing: selection.briefingEnabled,
      memory: selection.contextMdEnabled,
    };
  }

  return {
    brand: true,
    brandSource: selection.brand.source === "project" ? "project" : "workspace",
    briefing: selection.briefingEnabled,
    memory: selection.contextMdEnabled,
  };
}
