import "server-only";

import * as Sentry from "@sentry/nextjs";
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

export const sourceImportService = (() => {
  /**
   * Enqueues file and HTTP links found in a markdown string for processing.
   *
   * - Extracts file-like links (e.g., direct file URLs) and generic HTTP links from the provided markdown.
   * - For each file-like link that is a valid HTTP URL, creates a pending result blob in the database,
   *   guessing the file name from the URL if possible.
   * - For each HTTP link that is a valid HTTP URL, upserts a link record in the database.
   * - All operations are performed within a single database transaction for consistency.
   *
   * @param jobEventId - The ID of the job event associated with the result (and blobs).
   * @param markdown - The markdown content to scan for links.
   * @returns A Promise that resolves when the operation is complete.
   */
  async function enqueueFromMarkdown(
    jobEventId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);
    const httpLinks = extractHttpLinks(markdown);
    if (fileLinks.length === 0 && httpLinks.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const url of fileLinks) {
        if (!isHttpUrl(url)) continue;
        const guessedName = getUrlBasename(url) ?? undefined;
        try {
          await blobRepository.upsertOutputBlob(
            {
              eventId: jobEventId,
              sourceUrl: url,
              name: guessedName,
            },
            tx,
          );
        } catch (error) {
          Sentry.captureException(error);
          continue;
        }
      }
      for (const url of httpLinks) {
        if (!isHttpUrl(url)) continue;
        try {
          await linkRepository.upsertLink(
            {
              eventId: jobEventId,
              url,
              title: undefined,
            },
            tx,
          );
        } catch (error) {
          Sentry.captureException(error);
          continue;
        }
      }
    });
  }

  return { enqueueFromMarkdown };
})();
