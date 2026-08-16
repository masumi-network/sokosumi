import "server-only";

import {
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
} from "@sokosumi/utils";
import { projectService } from "@/lib/services/project.service";
import {
  descriptionIncludesTaskAttachmentLink,
  formatTaskAttachmentMarkdown,
} from "@/lib/utils/task-attachments";

export interface ProjectTaskAttachment {
  label: string;
  url: string;
}

export interface ResolvedProjectAttachments {
  briefing: ProjectTaskAttachment | null;
  contextMd: ProjectTaskAttachment | null;
}

interface ProjectAttachmentOptions {
  skipBriefing?: boolean;
  skipContextMd?: boolean;
}

function toProjectTaskAttachment(
  label: string,
  url: string | null,
): ProjectTaskAttachment | null {
  const normalizedUrl = url?.trim();
  return normalizedUrl ? { label, url: normalizedUrl } : null;
}

function withProjectAttachments(
  description: string,
  attachments: ResolvedProjectAttachments,
  options: ProjectAttachmentOptions = {},
): string {
  const candidates = [
    options.skipBriefing ? null : attachments.briefing,
    options.skipContextMd ? null : attachments.contextMd,
  ];
  const missingAttachments = candidates.filter(
    (attachment): attachment is ProjectTaskAttachment =>
      attachment !== null &&
      !descriptionIncludesTaskAttachmentLink(
        description,
        attachment.label,
        attachment.url,
      ),
  );

  if (missingAttachments.length === 0) {
    return description;
  }

  const attachmentBlock = missingAttachments
    .map((attachment) =>
      formatTaskAttachmentMarkdown(attachment.label, attachment.url).trimEnd(),
    )
    .join("\n\n");
  const trimmedDescription = description.trimStart();

  return trimmedDescription
    ? `${attachmentBlock}\n\n${trimmedDescription}`
    : attachmentBlock;
}

export const projectFilesService = (() => {
  async function resolveProjectAttachments(
    projectId: string,
  ): Promise<ResolvedProjectAttachments> {
    const project = await projectService.getProjectById(projectId);

    return {
      briefing: toProjectTaskAttachment(
        PROJECT_BRIEFING_ATTACHMENT_LABEL,
        project?.briefingUrl ?? null,
      ),
      contextMd: toProjectTaskAttachment(
        PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
        project?.contextMd?.url ?? null,
      ),
    };
  }

  async function appendProjectFilesToDescription(
    description: string,
    projectId: string,
    options: ProjectAttachmentOptions = {},
  ): Promise<string> {
    if (options.skipBriefing && options.skipContextMd) {
      return description;
    }

    const attachments = await resolveProjectAttachments(projectId);
    return withProjectAttachments(description, attachments, options);
  }

  return {
    appendProjectFilesToDescription,
    resolveProjectAttachments,
    withProjectAttachments,
  };
})();
