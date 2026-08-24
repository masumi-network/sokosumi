import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import {
  blobRepository,
  linkRepository,
} from "@sokosumi/database/repositories";
import {
  extractFileLikeLinks,
  extractHttpLinks,
  getUrlBasename,
  isHttpUrl,
} from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

/**
 * Narrow client type for TaskFile operations.
 * Represents only the subset of PrismaClient/TransactionClient used by enqueueTaskOutputsFromMarkdown.
 */
export interface TaskFileClient {
  taskFile: {
    findFirst(args: {
      where: {
        taskId: string;
        OR: Array<{ fileUrl: string } | { sourceUrl: string }>;
      };
    }): Promise<{
      id: string;
      taskId: string;
      fileUrl: string | null;
      sourceUrl: string | null;
      origin: string;
      status?: string;
    } | null>;
    upsert(args: {
      where: { taskId_sourceUrl: { taskId: string; sourceUrl: string } };
      update: Record<string, never>;
      create: {
        taskId: string;
        name: string;
        sourceUrl: string;
        fileUrl: null;
        status: string;
        origin: string;
      };
    }): Promise<unknown>;
  };
}

/**
 * Type that accepts either a full Prisma client or the narrow TaskFileClient interface.
 */
export type TaskFileClientLike = PrismaClientOrTx | TaskFileClient;

export const sourceImportService = {
  async enqueueFromMarkdown(
    jobEventId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);
    const httpLinks = extractHttpLinks(markdown);

    if (fileLinks.length === 0 && httpLinks.length === 0) {
      return;
    }

    for (const url of fileLinks) {
      if (!isHttpUrl(url)) {
        continue;
      }

      try {
        await blobRepository.upsertOutputBlob(
          {
            eventId: jobEventId,
            sourceUrl: url,
            name: getUrlBasename(url) ?? undefined,
          },
          prisma,
        );
      } catch (error) {
        Sentry.captureException(error);
      }
    }

    for (const url of httpLinks) {
      if (!isHttpUrl(url)) {
        continue;
      }

      try {
        await linkRepository.upsertLink(
          {
            eventId: jobEventId,
            url,
            title: undefined,
          },
          prisma,
        );
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  },

  /**
   * Enqueue PENDING task-output TaskFiles from markdown comment links.
   * @param taskId - The task ID
   * @param markdown - Markdown comment text
   * @param client - Prisma client, transaction, or narrow TaskFileClient (uses client.taskFile.findFirst and client.taskFile.upsert)
   */
  async enqueueTaskOutputsFromMarkdown(
    taskId: string,
    markdown: string,
    client: TaskFileClientLike,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);

    if (fileLinks.length === 0) {
      return;
    }

    for (const url of fileLinks) {
      if (!isHttpUrl(url)) {
        continue;
      }

      try {
        // Skip if a TaskFile already exists with matching fileUrl or sourceUrl.
        // This prevents duplicate rows when user uploads a file (fileUrl=blob, sourceUrl=null)
        // then posts a comment with that blob URL (sourceUrl=blob, fileUrl=null).
        const existing = await client.taskFile.findFirst({
          where: {
            taskId,
            OR: [{ fileUrl: url }, { sourceUrl: url }],
          },
        });

        if (existing) {
          continue;
        }

        const basename = getUrlBasename(url) ?? "file";
        // Upsert PENDING task-output TaskFile. Unique on (taskId, sourceUrl).
        // Do NOT set fileUrl yet — source-import cron will fetch and upload.
        // update: {} preserves READY name on repeat URL (no-op update).
        await client.taskFile.upsert({
          where: {
            taskId_sourceUrl: {
              taskId,
              sourceUrl: url,
            },
          },
          update: {},
          create: {
            taskId,
            name: basename,
            sourceUrl: url,
            fileUrl: null,
            status: "PENDING",
            origin: "TASK_OUTPUT",
          },
        });
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  },
};
