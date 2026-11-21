import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import {
  buildOrganizationDriveFilePathname,
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathname,
  buildUserDriveFilePathnameWithFolder,
} from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import { isInDataRoom } from "@/lib/drive-blob";
import { type FileActor } from "@/lib/files/actor";
import { loadLiveResources } from "@/services/file-search.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

/**
 * The Drive the owner sees on their Files page in the bot's workspace: the
 * organization's in an organization workspace, their own in the personal
 * one. Always writing to the personal Drive made a file "in my Files"
 * invisible where the owner looked, while the bot still found it.
 */
export async function ownerDrive(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
) {
  const userId = actingMemberOf(authorized);
  const workspace = await prisma.workspace.findUnique({
    where: { id: authorized.turn.workspaceId },
    select: { id: true, organizationId: true },
  });
  if (!workspace)
    throw new SokoBotRuntimeValidationError("Workspace not found");
  const { id: workspaceId, organizationId } = workspace;
  return {
    key: organizationId
      ? {
          workspaceId,
          scope: "organization" as const,
          ownerId: organizationId,
        }
      : { workspaceId, scope: "user" as const, ownerId: userId },
    pathname: (filename: string) =>
      organizationId
        ? buildOrganizationDriveFilePathname(organizationId, filename)
        : buildUserDriveFilePathname(userId, filename),
    pathnameIn: (folder: string, filename: string) =>
      organizationId
        ? buildOrganizationDriveFilePathnameWithFolder(
            organizationId,
            folder,
            filename,
          )
        : buildUserDriveFilePathnameWithFolder(userId, folder, filename),
    actor: {
      userId,
      organizationId,
      kind: "soko_bot",
      sokoBotScope: authorized.reader.sharedScope,
    } satisfies FileActor,
  };
}

export async function ownerFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  fileId: string,
) {
  const drive = await runtime.ownerDrive(authorized);
  const [file] = await loadLiveResources({
    workspaceId: drive.key.workspaceId,
    actor: drive.actor,
    resourceIds: [fileId],
  });
  if (!file)
    throw new SokoBotRuntimeValidationError(
      "File not found; use an id from list_files",
    );
  return file;
}

/** Moves one of the owner's Drive files into a folder of the same Drive. */
/** A file in the owner's Files, by id; Task files stay with their Task. */
export async function ownerDriveFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  fileId: string,
) {
  const drive = await runtime.ownerDrive(authorized);
  const resource = await prisma.fileResource.findFirst({
    where: {
      id: fileId,
      workspaceId: drive.key.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope:
        drive.key.scope === "organization"
          ? FileSourceScope.ORGANIZATION
          : FileSourceScope.USER,
      tombstonedAt: null,
      ...(drive.key.scope === "organization"
        ? { ownerOrganizationId: drive.key.ownerId }
        : { ownerUserId: drive.key.ownerId }),
    },
    select: { id: true, sourceId: true, displayName: true },
  });
  // An organization's data rooms are for the people let in, never agents.
  if (
    !resource ||
    (drive.key.scope === "organization" &&
      (await isInDataRoom(resource.sourceId)))
  )
    throw new SokoBotRefusedUnsentError(
      "No file with that id in your owner's Files; files from Tasks stay with their Task",
    );
  return { drive, resource };
}
