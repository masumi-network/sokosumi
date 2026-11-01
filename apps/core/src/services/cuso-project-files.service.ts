import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";

import prisma from "@/lib/db/prisma";
import type { Cuso } from "@/services/cmo-cuso.service";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import { updateFileMetadata } from "@/services/file-metadata.service";

/**
 * Where Cuso saves files: the organization's Files (the runner's when there is
 * no organization), each one confirmed on his Project (ADR 0062).
 */
export interface CusoDrive {
  workspaceId: string;
  organizationId: string | null;
  /** Cuso's runner (ADR 0061): the files are saved as this member. */
  userId: string;
  /** Cuso's Project: every saved file is confirmed as one of its files. */
  projectId: string;
}

/** Cuso's Drive, or null when his workspace has no member to save as. */
export async function cusoDrive(
  cuso: Pick<Cuso, "workspaceId" | "sokoBotId" | "projectId">,
): Promise<CusoDrive | null> {
  // Loaded here: the CMO services import this module.
  const { cmoRunnerUserId } = await import("@/services/cmo-cuso.service");
  const runnerId = await cmoRunnerUserId(cuso);
  if (!runnerId) return null;
  const workspace = await prisma.workspace.findUnique({
    where: { id: cuso.workspaceId },
    select: { organizationId: true },
  });
  if (!workspace) return null;
  return {
    workspaceId: cuso.workspaceId,
    organizationId: workspace.organizationId,
    userId: runnerId,
    projectId: cuso.projectId,
  };
}

/** Confirms the file on the Project, as Cuso's runner; best effort. */
async function linkToProject(
  drive: CusoDrive,
  resourceId: string,
): Promise<void> {
  try {
    // The index job queued on upload may edit the metadata at the same time.
    for (let attempt = 0; attempt < 3; attempt++) {
      const resource = await prisma.fileResource.findUnique({
        where: { id: resourceId },
        select: { metadataRevision: true },
      });
      if (!resource) return;
      const outcome = await updateFileMetadata({
        workspaceId: drive.workspaceId,
        actor: {
          userId: drive.userId,
          organizationId: drive.organizationId,
          kind: "soko_bot",
        },
        resourceId,
        request: {
          expectedMetadataRevision: resource.metadataRevision,
          confirmProjectIds: [drive.projectId],
        },
      });
      if (outcome.status !== "conflict") return;
    }
  } catch (error) {
    console.warn("Cuso's file not linked to the Project", {
      projectId: drive.projectId,
      resourceId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Writes bytes into Cuso's Drive, as a re-upload when the name exists, and
 * confirms the file on the Project. A file is named by folder and filename,
 * or rewritten in place by the pathname it already has. Returns the file's id.
 */
export async function saveCusoProjectFile(
  drive: CusoDrive,
  target:
    | { folder: string; filename: string }
    | { pathname: string; filename: string },
  body: Buffer,
  contentType: string,
): Promise<string | null> {
  const pathname =
    "pathname" in target
      ? target.pathname
      : drive.organizationId
        ? buildOrganizationDriveFilePathnameWithFolder(
            drive.organizationId,
            target.folder,
            target.filename,
          )
        : buildUserDriveFilePathnameWithFolder(
            drive.userId,
            target.folder,
            target.filename,
          );
  const key = drive.organizationId
    ? {
        workspaceId: drive.workspaceId,
        scope: "organization" as const,
        ownerId: drive.organizationId,
        pathname,
      }
    : {
        workspaceId: drive.workspaceId,
        scope: "user" as const,
        ownerId: drive.userId,
        pathname,
      };
  await reserveDriveUploadResource({
    key,
    displayName: target.filename,
    mimeType: contentType,
    sizeBytes: body.length,
  });
  await put(pathname, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes: body.length,
    mimeType: contentType,
  });
  if (!activated) return null;
  await linkToProject(drive, activated.resourceId);
  return activated.resourceId;
}
