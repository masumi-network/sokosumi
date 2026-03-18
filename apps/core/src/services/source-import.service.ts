import * as Sentry from "@sentry/node";
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

export const sourceImportService = {
  async enqueueFromMarkdown(
    _userId: string,
    jobEventId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);
    const httpLinks = extractHttpLinks(markdown);

    if (fileLinks.length === 0 && httpLinks.length === 0) {
      return;
    }

    await prisma.$transaction(async (tx) => {
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
            tx,
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
            tx,
          );
        } catch (error) {
          Sentry.captureException(error);
        }
      }
    });
  },
};
