import * as Sentry from "@sentry/node";
import { Prisma } from "@sokosumi/database";
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

  async enqueueTaskOutputsFromMarkdown(
    taskId: string,
    markdown: string,
    client: PrismaClientOrTx,
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
