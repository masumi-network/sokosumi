import * as Sentry from "@sentry/node";
import { Prisma, TaskStatus } from "@sokosumi/database";
import { removeTaskContextAttachmentLinks } from "@sokosumi/utils";
import { generateText } from "ai";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { uploadProjectContextMdFile } from "@/lib/project-files-blob";

const MEMORY_LOCK_TTL_MS = 5 * 60 * 1000;
const MEMORY_GENERATION_TIMEOUT_MS = 60_000;
const MAX_CONTEXT_LINES = 500;
const RECENT_COMPLETED_TASK_LIMIT = 5;
const TASK_EVENT_LIMIT = 12;
const TASK_FILE_LIMIT = 50;

const EMPTY_CONTEXT_TEMPLATE = `# Project Context

## Goals

## Decisions

## Outputs

## Open Questions`;

const PROJECT_MEMORY_SYSTEM_PROMPT = `You maintain CONTEXT.md, the living memory of a long-running project.

Rewrite the full document by merging important earlier facts with new learnings from completed tasks. Preserve durable decisions, goals, outputs, constraints, and unresolved questions. Remove repetition and obsolete process chatter. Never lose important earlier facts. Do not invent facts. Do not add or infer PII beyond source material.

Return only concise Markdown, without a surrounding code fence. Target at most 400 lines; output is hard-capped at 500 lines.`;

const PROJECT_MEMORY_TASK_SELECT = {
  id: true,
  name: true,
  description: true,
  updatedAt: true,
  assignee: {
    select: {
      name: true,
    },
  },
  events: {
    where: {
      OR: [{ comment: { not: null } }, { status: TaskStatus.COMPLETED }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TASK_EVENT_LIMIT,
    select: {
      id: true,
      createdAt: true,
      status: true,
      comment: true,
      channel: true,
    },
  },
  files: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: TASK_FILE_LIMIT,
    select: {
      name: true,
    },
  },
} satisfies Prisma.TaskSelect;

type ProjectMemoryTask = Prisma.TaskGetPayload<{
  select: typeof PROJECT_MEMORY_TASK_SELECT;
}>;

export interface RefreshProjectMemoryInput {
  projectId: string;
  taskId: string;
}

export interface ProjectMemoryRefreshResult {
  status: "updated" | "skipped";
  reason?:
    | "missing_api_key"
    | "already_updating"
    | "project_not_found"
    | "task_not_found"
    | "empty_output"
    | "blob_upload_failed"
    | "lost_lock";
  version?: number;
  lineCount?: number;
}

function formatTaskForPrompt(task: ProjectMemoryTask): string {
  const chronologicalEvents = [...task.events].reverse();
  const completedAt = task.events.find(
    (event) => event.status === TaskStatus.COMPLETED,
  )?.createdAt;
  const files = task.files.map((file) => file.name).join(", ") || "None";
  const events =
    chronologicalEvents
      .map((event) => {
        const parts = [
          event.createdAt.toISOString(),
          event.status ? `status=${event.status}` : null,
          event.comment ? `comment=${JSON.stringify(event.comment)}` : null,
          `channel=${event.channel}`,
        ].filter(Boolean);
        return `- ${parts.join(" · ")}`;
      })
      .join("\n") || "- None";

  return `## Completed task: ${task.name}
- Task id: ${task.id}
- Description: ${removeTaskContextAttachmentLinks(task.description ?? "") || "None"}
- Assignee: ${task.assignee?.name || "Unassigned"}
- Completion time: ${(completedAt ?? task.updatedAt).toISOString()}
- Files: ${files}
- Final events and comments:
${events}`;
}

export function buildProjectMemoryPrompt(input: {
  projectName: string;
  briefing: string | null;
  currentContextMd: string | null;
  completedTasks: ProjectMemoryTask[];
}): string {
  return `# Project source

## Name
${input.projectName}

## Briefing
${input.briefing?.trim() || "No briefing provided."}

## Current CONTEXT.md
${input.currentContextMd?.trim() || EMPTY_CONTEXT_TEMPLATE}

# Newly completed work
${input.completedTasks.map(formatTaskForPrompt).join("\n\n")}`;
}

export function capProjectContextMd(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .split(/\r\n|\r|\n/)
    .slice(0, MAX_CONTEXT_LINES)
    .join("\n")
    .trimEnd();
}

async function releaseProjectMemoryLock(
  projectId: string,
  lockStartedAt: Date,
): Promise<void> {
  try {
    await prisma.project.updateMany({
      where: { id: projectId, contextMdUpdatingSince: lockStartedAt },
      data: { contextMdUpdatingSince: null },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { error_type: "project_memory_lock_release_failed" },
      extra: { projectId },
    });
  }
}

async function refreshAfterTaskCompleted({
  projectId,
  taskId,
}: RefreshProjectMemoryInput): Promise<ProjectMemoryRefreshResult> {
  const env = getEnv();
  if (!env.AI_GATEWAY_API_KEY) {
    console.warn(
      "Project memory refresh skipped: AI_GATEWAY_API_KEY is missing",
    );
    return { status: "skipped", reason: "missing_api_key" };
  }

  const lockStartedAt = new Date();
  const staleBefore = new Date(lockStartedAt.getTime() - MEMORY_LOCK_TTL_MS);
  const lockResult = await prisma.project.updateMany({
    where: {
      id: projectId,
      OR: [
        { contextMdUpdatingSince: null },
        { contextMdUpdatingSince: { lt: staleBefore } },
      ],
    },
    data: { contextMdUpdatingSince: lockStartedAt },
  });

  if (lockResult.count === 0) {
    return { status: "skipped", reason: "already_updating" };
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      return { status: "skipped", reason: "project_not_found" };
    }

    const completedEventFilter = project.contextMdUpdatedAt
      ? { createdAt: { gt: project.contextMdUpdatedAt } }
      : {};
    const [triggeringTask, recentCompletedTasks] = await Promise.all([
      prisma.task.findFirst({
        where: { id: taskId, projectId },
        select: PROJECT_MEMORY_TASK_SELECT,
      }),
      prisma.task.findMany({
        where: {
          projectId,
          id: { not: taskId },
          events: {
            some: {
              status: TaskStatus.COMPLETED,
              ...completedEventFilter,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: RECENT_COMPLETED_TASK_LIMIT - 1,
        select: PROJECT_MEMORY_TASK_SELECT,
      }),
    ]);

    if (!triggeringTask) {
      return { status: "skipped", reason: "task_not_found" };
    }

    const prompt = buildProjectMemoryPrompt({
      projectName: project.name,
      briefing: project.briefing,
      currentContextMd: project.contextMd,
      completedTasks: [triggeringTask, ...recentCompletedTasks],
    });
    const generation = await generateText({
      model: env.PROJECT_MEMORY_MODEL,
      system: PROJECT_MEMORY_SYSTEM_PROMPT,
      prompt,
      timeout: MEMORY_GENERATION_TIMEOUT_MS,
      providerOptions: {
        gateway: {
          only: ["mistral"],
        },
      },
    });
    const contextMd = capProjectContextMd(generation.text);
    if (!contextMd) {
      console.warn(
        "Project memory refresh skipped: model returned empty output",
        {
          projectId,
          taskId,
        },
      );
      return { status: "skipped", reason: "empty_output" };
    }

    const contextMdUrl = await uploadProjectContextMdFile(projectId, contextMd);
    if (!contextMdUrl) {
      return { status: "skipped", reason: "blob_upload_failed" };
    }

    const lineCount = contextMd.split("\n").length;
    const updateResult = await prisma.project.updateMany({
      where: {
        id: projectId,
        contextMdUpdatingSince: lockStartedAt,
        contextMdVersion: project.contextMdVersion,
      },
      data: {
        contextMd,
        contextMdUrl,
        contextMdUpdatedAt: new Date(),
        contextMdModel: env.PROJECT_MEMORY_MODEL,
        contextMdVersion: { increment: 1 },
        contextMdUpdatingSince: null,
      },
    });
    if (updateResult.count === 0) {
      return { status: "skipped", reason: "lost_lock" };
    }

    return {
      status: "updated",
      version: project.contextMdVersion + 1,
      lineCount,
    };
  } finally {
    await releaseProjectMemoryLock(projectId, lockStartedAt);
  }
}

export const projectMemoryService = {
  refreshAfterTaskCompleted,
};
