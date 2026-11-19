import type { Prisma, Project } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, isOwnedProjectLogoUrl } from "@sokosumi/utils";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { isProjectIdentifierUniqueConstraintError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import {
  deleteProjectBriefingBlob,
  ensureProjectFilesToken,
  generateProjectFilesToken,
  uploadProjectBriefingFile,
} from "@/lib/project-files-blob";
import type { StudioLogoPosition } from "@/schemas/project-image-studio.schema";

export interface CreateProjectInput {
  name: string;
  briefing?: string | null;
  websiteUrl?: string | null;
  identifier?: string;
}

export interface UpdateProjectInput {
  name?: string;
  briefing?: string | null;
  websiteUrl?: string | null;
  logo?: string | null;
  studioLogoPosition?: StudioLogoPosition | null;
  identifier?: string;
  postingInstructionsMd?: string | null;
}

function identifierTaken(error: unknown): never {
  throw isProjectIdentifierUniqueConstraintError(error)
    ? conflict("Project identifier already in use in this workspace", {
        kind: CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN,
      })
    : error;
}

/** A project in the workspace, with its briefing stored as a file. */
export async function createProject(
  workspaceId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const briefing = input.briefing?.trim() || null;
  const filesToken = briefing ? generateProjectFilesToken() : null;

  const project = await prisma.project
    .create({
      data: {
        workspaceId,
        name: input.name,
        ...(input.identifier !== undefined
          ? { identifier: input.identifier }
          : {}),
        filesToken,
        briefing,
        websiteUrl: input.websiteUrl ?? null,
      },
    })
    .catch(identifierTaken);
  await deliverCalendarInvalidationsNow(workspaceId);

  if (!briefing || !filesToken) return project;
  const briefingUrl = await uploadProjectBriefingFile(
    project.id,
    filesToken,
    briefing,
  );
  return briefingUrl
    ? prisma.project.update({
        where: { id: project.id },
        data: { briefingUrl },
      })
    : project;
}

/** Changes only the fields given; a cleared briefing also drops its file. */
export async function updateProject(
  workspaceId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const data: Prisma.ProjectUpdateManyMutationInput = {
    projectRevision: { increment: 1 },
  };
  if (input.name !== undefined) data.name = input.name;
  if (input.identifier !== undefined) data.identifier = input.identifier;
  if (input.websiteUrl !== undefined)
    data.websiteUrl = input.websiteUrl ?? null;
  if (input.logo !== undefined) {
    if (input.logo !== null && !isOwnedProjectLogoUrl(input.logo, id)) {
      throw unprocessableEntity(
        "Logo must be owned by this project's logo prefix",
      );
    }
    data.logo = input.logo ?? null;
  }
  if (input.logo === null) data.studioLogoPosition = null;
  else if (input.studioLogoPosition !== undefined)
    data.studioLogoPosition = input.studioLogoPosition;
  if (input.postingInstructionsMd !== undefined) {
    data.postingInstructionsMd = input.postingInstructionsMd?.trim() || null;
  }
  const existing = await prisma.project.findFirst({
    where: { id, workspaceId },
  });
  if (!existing) throw notFound("Project not found");

  let briefingUrlToDelete: string | null = null;
  if (input.briefing !== undefined) {
    const briefing = input.briefing?.trim() || null;
    data.briefing = briefing;
    if (!briefing) {
      data.briefingUrl = null;
      briefingUrlToDelete = existing.briefingUrl;
    } else {
      const filesToken = await ensureProjectFilesToken(id, existing.filesToken);
      if (!filesToken) throw notFound("Project not found");
      const briefingUrl = await uploadProjectBriefingFile(
        id,
        filesToken,
        briefing,
      );
      data.briefingUrl = briefingUrl;
      if (!briefingUrl) {
        recordCoreWarning(
          { operation: "project_update" },
          {
            message: "Saved a project's briefing without its file",
            why: "The project briefing upload to Blob storage returned no URL",
            fix: "The briefing text is saved; saving the project again uploads the file. If it keeps happening, check Blob storage.",
          },
          { project: { id } },
        );
      }
      if (existing.briefingUrl !== briefingUrl) {
        briefingUrlToDelete = existing.briefingUrl;
      }
    }
  }

  const { count } = await prisma.project
    .updateMany({ where: { id, workspaceId }, data })
    .catch(identifierTaken);
  if (count === 0) throw notFound("Project not found");
  await deliverCalendarInvalidationsNow(workspaceId);
  await deleteProjectBriefingBlob(briefingUrlToDelete);

  const project = await prisma.project.findFirst({
    where: { id, workspaceId },
  });
  if (!project) throw notFound("Project not found");
  return project;
}
