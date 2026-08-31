import { z } from "@hono/zod-openapi";
import {
  type Project as DatabaseProject,
  TaskStatus,
} from "@sokosumi/database";
import {
  isDesignMdBlobUrl,
  isProjectLogoBlobUrl,
  SokosumiJobStatus,
} from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { dateTimeSchema } from "@/helpers/datetime.js";
import { isProjectMemoryConfigured } from "@/lib/project-memory-config";
import {
  sokosumiJobStatusSchema,
  taskStatusSchema,
} from "@/schemas/domain-enums.schema";

const PROJECT_MEMORY_UPDATING_WINDOW_MS = 5 * 60 * 1000;

const projectWebsiteUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    // Refinements can run even when `.url()` already failed — never throw.
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Website URL must use HTTP or HTTPS");

const projectLogoUrlSchema = z
  .string()
  .url()
  .refine(
    isProjectLogoBlobUrl,
    "Logo must be a Vercel Blob URL under projects/{projectId}/logos/",
  );

const projectDesignMdUrlSchema = z
  .string()
  .url()
  .refine(isDesignMdBlobUrl, "URL must reference a stored DESIGN.md blob");

export const projectDesignMdSchema = z
  .object({
    url: projectDesignMdUrlSchema,
    extractionId: z.string().nullable(),
  })
  .openapi("ProjectDesignMd");

export const projectDesignMdWriteSchema = z
  .object({
    content: z
      .string()
      .refine((value) => value.trim().length > 0, "DESIGN.md must not be empty")
      .refine(
        (value) =>
          Buffer.byteLength(value, "utf8") <= LIMITS.DESIGN_MD_MAX_SIZE_BYTES,
        `DESIGN.md exceeds the maximum size of ${LIMITS.DESIGN_MD_MAX_SIZE_BYTES} bytes`,
      )
      .openapi({ example: "# DESIGN.md\n\nBrand guidelines…" }),
    extractionId: z.string().nullish().optional().openapi({ example: "12345" }),
  })
  .openapi("ProjectDesignMdWrite");

export const PROJECT_MEMORY_MODEL_LABELS: Readonly<Record<string, string>> = {
  "mistral/mistral-medium-3.5": "Mistral Medium",
  "mistral/mistral-medium-latest": "Mistral Medium",
};

export const projectMemoryModelSchema = z
  .object({
    id: z.string().openapi({ example: "mistral/mistral-medium-3.5" }),
    label: z.string().openapi({ example: "Mistral Medium" }),
    region: z.literal("eu"),
  })
  .openapi("ProjectMemoryModel");

export const projectContextMdMetadataSchema = z
  .object({
    url: z.url().openapi({
      example:
        "https://example.public.blob.vercel-storage.com/projects/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/CONTEXT.md",
    }),
    updatedAt: dateTimeSchema,
    version: z.number().int().nonnegative().openapi({ example: 3 }),
    model: projectMemoryModelSchema,
    lineCount: z.number().int().nonnegative().openapi({ example: 42 }),
  })
  .openapi("ProjectContextMdMetadata");

export const projectContextMdSchema = projectContextMdMetadataSchema
  .extend({
    content: z.string().openapi({ example: "# Project context" }),
  })
  .openapi("ProjectContextMd");

export const projectSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    workspaceId: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "Q1 research" }),
    briefing: z.string().nullable().openapi({ example: "Campaign briefing" }),
    briefingUrl: z.url().nullable().openapi({
      example:
        "https://example.public.blob.vercel-storage.com/projects/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/BRIEFING.md",
    }),
    websiteUrl: z.url().nullable().openapi({ example: "https://example.com" }),
    logo: z.url().nullable().openapi({
      example:
        "https://example.public.blob.vercel-storage.com/projects/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/logos/logo.png",
    }),
    designMd: z.union([projectDesignMdSchema, z.null()]).openapi({
      description: "Project-owned brand DESIGN.md, or null when none exists.",
      example: null,
    }),
    memoryEnabled: z.boolean().openapi({
      description:
        "Whether Core has both AI Gateway and Blob storage credentials and can update project memory.",
      example: true,
    }),
    memoryModel: projectMemoryModelSchema.openapi({
      description:
        "Configured EU model that will write project memory, including before the first update.",
    }),
    // Union-with-null instead of `.nullable()`: `.nullable()` on a named
    // `.openapi(...)` schema drops `| null` from the generated client and makes
    // the transformer call the date converter unconditionally (crashing on
    // null). Mirrors `historyBaseItemSchema.owner`.
    contextMd: z.union([projectContextMdMetadataSchema, z.null()]).openapi({
      description:
        "Project memory metadata. Null until the first task completion writes CONTEXT.md.",
      example: null,
    }),
    contextMdUpdating: z.boolean().openapi({ example: false }),
    projectRevision: z.number().int().nonnegative().default(0).openapi({
      description: "Revision used for optimistic Project mutations",
      example: 0,
    }),
    closingAt: dateTimeSchema.nullable().default(null).openapi({
      description: "Exclusive release cutoff while the Project is closing",
      example: null,
    }),
    closedAt: dateTimeSchema.nullable().default(null).openapi({
      description: "When the Project reached its terminal closed state",
      example: null,
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Project");

export const projectListItemSchema = projectSchema
  .extend({
    taskCount: z.number().int().nonnegative().openapi({ example: 2 }),
    jobCount: z.number().int().nonnegative().openapi({ example: 1 }),
  })
  .openapi("ProjectListItem");

function resolveProjectBriefingAlias(
  briefing: string | null | undefined,
  description: string | null | undefined,
): string | null | undefined {
  if (briefing === null && description === undefined) {
    return null;
  }
  return briefing ?? description;
}

export const createProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).openapi({ example: "Q1 research" }),
    briefing: z
      .string()
      .trim()
      .max(20_000)
      .nullish()
      .openapi({ example: "Optional campaign briefing" }),
    description: z.string().trim().max(20_000).nullish().openapi({
      deprecated: true,
      description: "Deprecated. Use briefing instead.",
      example: "Legacy campaign briefing",
    }),
    websiteUrl: projectWebsiteUrlSchema.nullish().optional(),
  })
  .transform(({ description, ...data }) => ({
    ...data,
    briefing: resolveProjectBriefingAlias(data.briefing, description),
  }))
  .openapi("CreateProjectRequest");

export const patchProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    briefing: z.string().trim().max(20_000).nullish().optional(),
    description: z.string().trim().max(20_000).nullish().openapi({
      deprecated: true,
      description: "Deprecated. Use briefing instead.",
    }),
    websiteUrl: projectWebsiteUrlSchema.nullish().optional(),
    logo: projectLogoUrlSchema.nullish().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.name === undefined &&
      data.briefing === undefined &&
      data.description === undefined &&
      data.websiteUrl === undefined &&
      data.logo === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide at least one of name, briefing, description, websiteUrl, or logo",
        path: [],
      });
    }
  })
  .transform(({ description, ...data }) => ({
    ...data,
    briefing: resolveProjectBriefingAlias(data.briefing, description),
  }))
  .openapi("PatchProjectRequest");

export const addProjectJobRequestSchema = z
  .object({
    jobId: z.string().min(1).openapi({ example: "job_abc" }),
  })
  .openapi("AddProjectJobRequest");

export const addProjectTaskRequestSchema = z
  .object({
    taskId: z.string().min(1).openapi({ example: "tsk_abc" }),
  })
  .openapi("AddProjectTaskRequest");

const statusCountBaseSchema = z.object({
  count: z.number().int().nonnegative().openapi({ example: 2 }),
});

export const taskStatusCountSchema = statusCountBaseSchema
  .extend({
    status: taskStatusSchema.openapi({ example: TaskStatus.READY }),
  })
  .openapi("ProjectTaskStatusCount");

export const jobStatusCountSchema = statusCountBaseSchema
  .extend({
    status: sokosumiJobStatusSchema.openapi({
      example: SokosumiJobStatus.PROCESSING,
    }),
  })
  .openapi("ProjectJobStatusCount");

export const projectResourceStatsSchema = <
  TStatusCountSchema extends z.ZodType,
>(
  statusCountSchema: TStatusCountSchema,
) =>
  z.object({
    total: z.number().int().nonnegative().openapi({ example: 3 }),
    byStatus: z.array(statusCountSchema).openapi({ example: [] }),
  });

export const projectStatsEntrySchema = z
  .object({
    projectId: z.string().uuid().openapi({
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    tasks: projectResourceStatsSchema(taskStatusCountSchema),
    jobs: projectResourceStatsSchema(jobStatusCountSchema),
  })
  .openapi("ProjectStatsEntry");

export const projectStatsBatchSchema = z
  .object({
    projects: z.array(projectStatsEntrySchema),
  })
  .openapi("ProjectStatsBatch");

export type Project = z.infer<typeof projectSchema>;
export type ProjectContextMd = z.infer<typeof projectContextMdSchema>;

function countLines(content: string): number {
  return content.split(/\r\n|\r|\n/).length;
}

export function mapProjectContextMdForApi(
  project: DatabaseProject,
): ProjectContextMd | null {
  if (
    project.contextMd === null ||
    project.contextMdUrl === null ||
    project.contextMdUpdatedAt === null ||
    project.contextMdModel === null
  ) {
    return null;
  }

  return projectContextMdSchema.parse({
    content: project.contextMd,
    url: project.contextMdUrl,
    updatedAt: project.contextMdUpdatedAt,
    version: project.contextMdVersion,
    model: {
      id: project.contextMdModel,
      label:
        PROJECT_MEMORY_MODEL_LABELS[project.contextMdModel] ??
        project.contextMdModel,
      region: "eu",
    },
    lineCount: countLines(project.contextMd),
  });
}

export function mapProjectForApi(
  project: DatabaseProject,
  now: Date = new Date(),
): Project {
  const env = getEnv();
  const updatingSinceMs = project.contextMdUpdatingSince?.getTime();
  const contextMd = mapProjectContextMdForApi(project);

  return projectSchema.parse({
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    briefing: project.briefing,
    briefingUrl: project.briefingUrl,
    websiteUrl: project.websiteUrl,
    logo: project.logo,
    designMd: project.designMdUrl
      ? {
          url: project.designMdUrl,
          extractionId: project.designMdExtractionId,
        }
      : null,
    memoryEnabled: isProjectMemoryConfigured(env),
    memoryModel: {
      id: env.PROJECT_MEMORY_MODEL,
      label:
        PROJECT_MEMORY_MODEL_LABELS[env.PROJECT_MEMORY_MODEL] ??
        env.PROJECT_MEMORY_MODEL,
      region: "eu",
    },
    contextMd: contextMd
      ? {
          url: contextMd.url,
          updatedAt: contextMd.updatedAt,
          version: contextMd.version,
          model: contextMd.model,
          lineCount: contextMd.lineCount,
        }
      : null,
    contextMdUpdating:
      updatingSinceMs !== undefined &&
      now.getTime() - updatingSinceMs < PROJECT_MEMORY_UPDATING_WINDOW_MS,
    projectRevision: project.projectRevision ?? 0,
    closingAt: project.closingAt ?? null,
    closedAt: project.closedAt ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}
