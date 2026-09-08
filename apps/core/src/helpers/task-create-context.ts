import type { Prisma } from "@sokosumi/database";
import {
  buildAdHocDesignMdPrefix,
  DESIGN_MD_ATTACHMENT_LABEL,
  descriptionIncludesTaskAttachmentLink,
  formatTaskAttachmentMarkdown,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
} from "@sokosumi/utils";
import { resolveEffectiveDesignMd } from "@/helpers/design-md-effective";
import { notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  ensureProjectFilesToken,
  uploadProjectBriefingFile,
} from "@/lib/project-files-blob";
import type { CreateTaskContext } from "@/schemas/task.schema";

const TASK_CONTEXT_PROJECT_SELECT = {
  id: true,
  filesToken: true,
  designMdUrl: true,
  briefing: true,
  briefingUrl: true,
  contextMdUrl: true,
} satisfies Prisma.ProjectSelect;

export type TaskContextProject = Prisma.ProjectGetPayload<{
  select: typeof TASK_CONTEXT_PROJECT_SELECT;
}>;

type TaskContextProjectDatabase = Pick<Prisma.TransactionClient, "project">;

export async function findTaskProjectInWorkspace(
  projectId: string | null | undefined,
  workspaceId: string,
  db: TaskContextProjectDatabase = prisma,
): Promise<TaskContextProject | null> {
  if (projectId === null || projectId === undefined) {
    return null;
  }

  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: TASK_CONTEXT_PROJECT_SELECT,
  });
  if (!project) {
    throw notFound("Project not found");
  }

  return project;
}

export async function healProjectBriefingUrl(
  project: TaskContextProject | null,
  workspaceId: string,
  db: TaskContextProjectDatabase = prisma,
): Promise<TaskContextProject | null> {
  if (!project?.briefing || project.briefingUrl) {
    return project;
  }

  const filesToken = await ensureProjectFilesToken(
    project.id,
    project.filesToken,
  );
  if (!filesToken) {
    return project;
  }

  const briefingUrl = await uploadProjectBriefingFile(
    project.id,
    filesToken,
    project.briefing,
  );
  if (!briefingUrl) {
    return project;
  }

  const updateResult = await db.project.updateMany({
    where: {
      id: project.id,
      workspaceId,
      briefing: project.briefing,
      briefingUrl: null,
    },
    data: { briefingUrl },
  });

  return updateResult.count === 1
    ? { ...project, filesToken, briefingUrl }
    : project;
}

interface TaskContextAttachment {
  label: string;
  url: string;
}

function isUrlUnderPathPrefix(url: string, prefix: string): boolean {
  try {
    return decodeURIComponent(new URL(url).pathname).startsWith(`/${prefix}`);
  } catch {
    return false;
  }
}

function prependTaskContextAttachments(
  description: string | null | undefined,
  attachments: TaskContextAttachment[],
): string | null {
  const existingDescription = description ?? "";
  const missingAttachments = attachments.filter(
    ({ label, url }) =>
      !descriptionIncludesTaskAttachmentLink(existingDescription, label, url),
  );

  if (missingAttachments.length === 0) {
    return description ?? null;
  }

  const attachmentMarkdown = missingAttachments
    .map(({ label, url }) => formatTaskAttachmentMarkdown(label, url).trimEnd())
    .join("\n");

  return existingDescription
    ? `${attachmentMarkdown}\n\n${existingDescription}`
    : attachmentMarkdown;
}

export async function resolveTaskDescriptionWithContext({
  context,
  description,
  organizationId,
  ownerId,
  project,
  tx,
}: {
  context: CreateTaskContext | undefined;
  description: string | null | undefined;
  organizationId: string | null;
  ownerId: string;
  project: TaskContextProject | null;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const attachments: TaskContextAttachment[] = [];
  let effectiveDesignMdUrl: string | null | undefined;

  async function getEffectiveDesignMdUrl(): Promise<string | null> {
    if (effectiveDesignMdUrl === undefined) {
      const effectiveDesignMd = await resolveEffectiveDesignMd({
        userId: ownerId,
        organizationId,
        tx,
      });
      effectiveDesignMdUrl = effectiveDesignMd?.url ?? null;
    }
    return effectiveDesignMdUrl;
  }

  if (context?.brand !== false) {
    let brandUrl: string | null = null;

    if (typeof context?.brand === "object") {
      brandUrl = context.brand.url;
      const isOwnedAdHocBrand = isUrlUnderPathPrefix(
        brandUrl,
        buildAdHocDesignMdPrefix(ownerId),
      );
      const isProjectBrand = brandUrl === project?.designMdUrl;
      if (
        !isOwnedAdHocBrand &&
        !isProjectBrand &&
        brandUrl !== (await getEffectiveDesignMdUrl())
      ) {
        throw unprocessableEntity(
          "Custom brand must be owned by the caller or selected project",
        );
      }
    } else if ((context?.brandSource ?? "project") === "project") {
      brandUrl = project?.designMdUrl ?? null;
    }

    if (!brandUrl) {
      brandUrl = await getEffectiveDesignMdUrl();
    }

    if (brandUrl) {
      attachments.push({ label: DESIGN_MD_ATTACHMENT_LABEL, url: brandUrl });
    }
  }

  if (context?.briefing !== false && project?.briefingUrl) {
    attachments.push({
      label: PROJECT_BRIEFING_ATTACHMENT_LABEL,
      url: project.briefingUrl,
    });
  }

  if (context?.memory !== false && project?.contextMdUrl) {
    attachments.push({
      label: PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
      url: project.contextMdUrl,
    });
  }

  return prependTaskContextAttachments(description, attachments);
}
