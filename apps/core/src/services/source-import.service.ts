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

/**
 * Longest URL the batched inserts accept. Both writes dedupe through a btree
 * unique that includes the URL, and Postgres cannot index an entry over about
 * 2704 bytes. One oversized row aborts the whole statement, so it would take
 * every other link for the same job event with it. The cut is conservative:
 * the event id and tuple header leave ample headroom below the real limit.
 */
const MAX_INDEXABLE_URL_BYTES = 2000;

/**
 * Drop URLs the unique index cannot hold, and report how many were dropped.
 * Reported rather than silent: the link is lost for good, because nothing
 * re-reads a job event's markdown.
 */
function keepIndexableUrls(urls: string[], jobEventId: string): string[] {
  const kept = urls.filter(
    (url) => Buffer.byteLength(url) <= MAX_INDEXABLE_URL_BYTES,
  );

  if (kept.length !== urls.length) {
    Sentry.captureMessage("Dropped source-import URLs over the index limit", {
      level: "warning",
      extra: { jobEventId, dropped: urls.length - kept.length },
    });
  }

  return kept;
}

export const sourceImportService = {
  async enqueueFromMarkdown(
    jobEventId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = keepIndexableUrls(
      extractFileLikeLinks(markdown).filter(isHttpUrl),
      jobEventId,
    );
    const httpLinks = keepIndexableUrls(
      extractHttpLinks(markdown).filter(isHttpUrl),
      jobEventId,
    );

    if (fileLinks.length > 0) {
      try {
        await blobRepository.createOutputBlobs(
          fileLinks.map((url) => ({
            eventId: jobEventId,
            sourceUrl: url,
            name: getUrlBasename(url) ?? undefined,
          })),
          prisma,
        );
      } catch (error) {
        Sentry.captureException(error, {
          extra: { jobEventId, blobs: fileLinks.length },
        });
      }
    }

    if (httpLinks.length > 0) {
      try {
        await linkRepository.createLinks(
          httpLinks.map((url) => ({ eventId: jobEventId, url })),
          prisma,
        );
      } catch (error) {
        Sentry.captureException(error, {
          extra: { jobEventId, links: httpLinks.length },
        });
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
