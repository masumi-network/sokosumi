import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import { unprocessableEntity } from "@/helpers/error";
import type { FileActor } from "@/lib/files/actor";
import { resolveFileActor } from "@/lib/files/actor";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Bind a Files request to one workspace and one actor.
 *
 * This reuses the Drive gate rather than introducing a second one: a reader
 * who cannot list the store cannot search it either, and the store-to-active-
 * workspace binding that `requireDriveFileAccess` enforces still applies.
 */
export interface FileRequestContext {
  workspaceId: string;
  actor: FileActor;
  scope: "user" | "organization";
  ownerId: string;
}

export async function resolveFileRequestContext(input: {
  authContext: AuthenticationContext;
  scope: "me" | "org";
  organizationId?: string;
}): Promise<FileRequestContext> {
  const userContext = await requireAuthorizedUserContext(input.authContext);

  if (input.scope === "org" && !input.organizationId) {
    throw unprocessableEntity("organizationId is required when scope=org");
  }

  const storeScope = input.scope === "me" ? "user" : "organization";
  const ownerId =
    input.scope === "me"
      ? userContext.userId
      : (input.organizationId as string);

  await requireDriveFileAccess(input.authContext, storeScope, ownerId);

  const workspace = await resolveDriveTasksWorkspace({
    userContext,
    scope: input.scope,
    organizationId: input.organizationId,
  });

  return {
    workspaceId: workspace.workspaceId,
    // The store this request is for, which `requireDriveFileAccess` has
    // just authorized — not the caller's active organization, which an
    // API-key or OAuth context never has.
    actor: resolveFileActor(userContext, {
      organizationId: storeScope === "organization" ? ownerId : null,
    }),
    scope: storeScope,
    ownerId,
  };
}
