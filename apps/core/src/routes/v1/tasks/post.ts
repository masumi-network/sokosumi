import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { type Prisma, TaskStatus } from "@sokosumi/database";
import {
  buildAdHocDesignMdPrefix,
  DESIGN_MD_ATTACHMENT_LABEL,
  descriptionIncludesTaskAttachmentLink,
  formatTaskAttachmentMarkdown,
  isDesignMdBlobUrl,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
} from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { resolveEffectiveDesignMd } from "@/helpers/design-md-effective";
import {
  errorResponseSchema,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { created } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import {
  refineAssigneeXorConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import {
  refineChannelOriginConflict,
  resolveTaskEventChannel,
} from "@/helpers/task-event-channel";
import { resolveTaskName } from "@/helpers/task-name";
import { notifyWorkspaceApproversOfPendingGrant } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  ensureProjectFilesToken,
  uploadProjectBriefingFile,
} from "@/lib/project-files-blob";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  taskEventChannelField,
  taskEventDeprecatedOriginField,
  taskSchema,
} from "@/schemas/task.schema";
import {
  createTaskForActor,
  type TaskDomainActor,
} from "@/services/task-domain.service";
import { taskInclude } from "@/types/task";

const customBrandSchema = z.object({
  url: z
    .string()
    .url()
    .refine(isDesignMdBlobUrl, "Brand URL must reference a DESIGN.md blob"),
});

export const createTaskContextSchema = z
  .object({
    brand: z.union([z.boolean(), customBrandSchema]).optional(),
    brandSource: z.enum(["project", "workspace"]).optional(),
    briefing: z.boolean().optional(),
    memory: z.boolean().optional(),
  })
  .openapi("CreateTaskContext");

export const createTaskRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(LIMITS.NAME_MAX_LENGTH)
      .optional()
      .openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    projectId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .openapi({ example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }),
    assigneeId: z.string().nullish().openapi({ example: "cow_123" }),
    /** @deprecated Use `assigneeId`. */
    coworkerId: z.string().nullish().openapi({
      example: "cow_123",
      deprecated: true,
      description: "Deprecated. Use assigneeId instead.",
    }),
    assigneeSokoBotId: z.string().uuid().nullish().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    status: z
      .enum([TaskStatus.DRAFT, TaskStatus.READY])
      .optional()
      .default(TaskStatus.DRAFT)
      .openapi({ example: TaskStatus.READY }),
    channel: taskEventChannelField.optional(),
    origin: taskEventDeprecatedOriginField.optional(),
    context: createTaskContextSchema.optional().openapi({
      description:
        "Task context attachments. DESIGN.md, project briefing, and project memory are attached by default; explicit false values opt out.",
    }),
  })
  .superRefine((data, ctx) => {
    refineChannelOriginConflict(data, ctx);
    refineAssigneeXorConflict(data, ctx);

    const assigneeId = resolveAssigneeIdFromRequest(data);
    const hasCoworker = assigneeId != null && assigneeId !== "";
    const hasSokoBot =
      data.assigneeSokoBotId != null && data.assigneeSokoBotId !== "";

    if (data.status !== TaskStatus.DRAFT && !hasCoworker && !hasSokoBot) {
      ctx.addIssue({
        code: "custom",
        message:
          "assigneeId or assigneeSokoBotId is required when creating a non-draft task",
        path: ["assigneeId"],
      });
    }
  })
  .transform((data) => {
    const { coworkerId: _coworkerId, ...rest } = data;
    return {
      ...rest,
      assigneeId: resolveAssigneeIdFromRequest(data),
      assigneeSokoBotId: data.assigneeSokoBotId ?? null,
      channel: resolveTaskEventChannel(data),
    };
  });

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create a task. By default Core prepends available DESIGN.md, project briefing, and project memory links. Use context flags only to opt out or select a workspace/custom brand.",
    tags: ["Tasks"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createTaskRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskSchema, "Create task"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: {
        description:
          "Forbidden. Delegated coworker create may return kind `grant_denied` / `grant_revoked` when vendor create access was denied.",
        content: jsonContent(errorResponseSchema),
      },
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

const TASK_CONTEXT_PROJECT_SELECT = {
  id: true,
  filesToken: true,
  designMdUrl: true,
  briefing: true,
  briefingUrl: true,
  contextMdUrl: true,
} satisfies Prisma.ProjectSelect;

type TaskContextProject = Prisma.ProjectGetPayload<{
  select: typeof TASK_CONTEXT_PROJECT_SELECT;
}>;

async function findTaskProjectInWorkspace(
  projectId: string | null | undefined,
  workspaceId: string,
): Promise<TaskContextProject | null> {
  if (projectId === null || projectId === undefined) {
    return null;
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      workspaceId,
    },
    select: TASK_CONTEXT_PROJECT_SELECT,
  });

  if (!project) {
    throw notFound("Project not found");
  }

  return project;
}

async function healProjectBriefingUrl(
  project: TaskContextProject | null,
  workspaceId: string,
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

  const updateResult = await prisma.project.updateMany({
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

async function resolveTaskDescriptionWithContext({
  context,
  description,
  organizationId,
  ownerId,
  project,
  tx,
}: {
  context: z.infer<typeof createTaskContextSchema> | undefined;
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
      attachments.push({
        label: DESIGN_MD_ATTACHMENT_LABEL,
        url: brandUrl,
      });
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

function resolveTaskDomainActor(
  authContext: AuthenticationContext,
  ownerId: string,
): TaskDomainActor {
  if (isCoworkerAuthContext(authContext)) {
    return {
      kind: "coworker",
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      enforceWorkspaceGrant: Boolean(authContext.context),
    };
  }

  if (isSokoBotAuthContext(authContext)) {
    return {
      kind: "soko_bot",
      sokoBotId: authContext.sokoBotId,
    };
  }

  return { kind: "user", userId: ownerId };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const userContext = requireUserContext(authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    await requireAssignedOrganizationSeat(
      userContext.userId,
      workspaceContext.organizationId,
    );

    const resolvedName = await resolveTaskName({
      name: body.name,
      description: body.description,
    });

    const shouldEnforceCreateGrant =
      isCoworkerAuthContext(authContext) && Boolean(authContext.context);
    const project = await findTaskProjectInWorkspace(
      body.projectId,
      workspaceContext.workspaceId,
    );
    const projectWithBriefing =
      !shouldEnforceCreateGrant && body.context?.briefing !== false
        ? await healProjectBriefingUrl(project, workspaceContext.workspaceId)
        : project;

    const task = await prisma.$transaction(async (tx) => {
      const createdTask = await createTaskForActor(
        {
          actor: resolveTaskDomainActor(authContext, userContext.userId),
          ownerId: userContext.userId,
          organizationId: userContext.organizationId,
          workspaceId: workspaceContext.workspaceId,
          projectId: body.projectId,
          name: resolvedName,
          description: body.description,
          resolveDescription: async (tx) => {
            const contextProject =
              shouldEnforceCreateGrant && body.context?.briefing !== false
                ? await healProjectBriefingUrl(
                    project,
                    workspaceContext.workspaceId,
                  )
                : projectWithBriefing;
            return resolveTaskDescriptionWithContext({
              context: body.context,
              description: body.description,
              organizationId: userContext.organizationId,
              ownerId: userContext.userId,
              project: contextProject,
              tx,
            });
          },
          assigneeId: body.assigneeId,
          assigneeSokoBotId: body.assigneeSokoBotId,
          status: body.status,
          channel: body.channel,
        },
        tx,
      );
      return tx.task.findUniqueOrThrow({
        where: { id: createdTask.id },
        include: taskInclude,
      });
    });

    if (
      isCoworkerAuthContext(authContext) &&
      task.status === TaskStatus.GRANT_PENDING &&
      task.pendingVendorGrantId
    ) {
      try {
        await notifyWorkspaceApproversOfPendingGrant({
          vendorId: authContext.vendorId,
          workspaceId: workspaceContext.workspaceId,
          grantId: task.pendingVendorGrantId,
        });
      } catch (error) {
        console.error(
          "Failed to notify approvers of pending vendor grant after task create",
          error,
        );
        Sentry.captureException(error, {
          extra: {
            grantId: task.pendingVendorGrantId,
            vendorId: authContext.vendorId,
            workspaceId: workspaceContext.workspaceId,
            errorType: "vendor-grant-notify-after-create",
          },
        });
      }
    }

    return created(c, taskSchema.parse(mapTask(task)));
  });
}
