import "server-only";

import * as Sentry from "@sentry/nextjs";
import { Blob, BlobStatus } from "@sokosumi/database";
import {
  blobRepository,
  linkRepository,
} from "@sokosumi/database/repositories";
import { head } from "@vercel/blob";
import pLimit from "p-limit";

import { uploadFileForBlob } from "@/lib/blob/utils";
import { extractFileLikeLinks, extractHttpLinks } from "@/lib/data/markdown";
import prisma from "@/lib/db/prisma";
import { isHttpUrl } from "@/lib/utils/file";

export const sourceImportService = (() => {
  function getBasename(url: string): string | null {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").pop() ?? "";
      return last || null;
    } catch {
      return null;
    }
  }

  /**
   * Enqueues file and HTTP links found in a markdown string for processing.
   *
   * - Extracts file-like links (e.g., direct file URLs) and generic HTTP links from the provided markdown.
   * - For each file-like link that is a valid HTTP URL, creates a pending result blob in the database,
   *   guessing the file name from the URL if possible.
   * - For each HTTP link that is a valid HTTP URL, upserts a link record in the database.
   * - All operations are performed within a single database transaction for consistency.
   *
   * @param userId - The ID of the user who owns the job and links.
   * @param jobStatusId - The ID of the job status associated with the result (and blobs).
   * @param markdown - The markdown content to scan for links.
   * @returns A Promise that resolves when the operation is complete.
   */
  async function enqueueFromMarkdown(
    userId: string,
    jobEventId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);
    const httpLinks = extractHttpLinks(markdown);
    if (fileLinks.length === 0 && httpLinks.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const url of fileLinks) {
        if (!isHttpUrl(url)) continue;
        const guessedName = getBasename(url) ?? undefined;
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

  /**
   * Imports a pending result blob by fetching its source URL, uploading the file,
   * and marking the blob as ready in the database. If the import fails at any step,
   * the blob is marked as failed.
   *
   * Steps:
   * 1. Validates that the blob is in PENDING status.
   * 2. Fetches the file from the blob's sourceUrl.
   * 3. Determines the file's content type and suggested filename.
   * 4. Uploads the file using the uploadFile utility.
   * 5. Reads blob metadata from storage.
   * 6. Marks the blob as READY with the uploaded file's metadata.
   * 7. If any error occurs, marks the blob as FAILED.
   *
   * @param blob - The Blob entity to import.
   */
  async function importBlob(blob: Blob): Promise<void> {
    if (blob.status !== BlobStatus.PENDING) return;

    const sourceUrl = blob.sourceUrl;
    try {
      const res = await fetch(sourceUrl, { redirect: "follow" });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      const contentType = res.headers.get("content-type");
      const suggestedName =
        parseContentDispositionFilename(
          res.headers.get("content-disposition"),
        ) ??
        blob.name ??
        getBasename(sourceUrl) ??
        "file";

      const arrayBuffer = await res.arrayBuffer();
      const file = new File([arrayBuffer], suggestedName, {
        type: contentType ?? "application/octet-stream",
      });
      const uploaded = await uploadFileForBlob(blob.id, file);
      const blobMetadata = await head(uploaded.url);

      await blobRepository.markBlobReady(
        blob.id,
        {
          fileUrl: uploaded.url,
          mimeType: blobMetadata.contentType,
          size: BigInt(blobMetadata.size),
          name: suggestedName,
        },
        prisma,
      );
    } catch (_error) {
      await blobRepository.markBlobFailed(blob.id, prisma);
    }
  }

  function parseContentDispositionFilename(
    disposition: string | null,
  ): string | null {
    if (!disposition) return null;
    const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(
      disposition,
    );
    const value = decodeURIComponent(match?.[1] ?? match?.[2] ?? "");
    return value || null;
  }

  /**
   * Imports all pending result blobs concurrently, up to a maximum of 5 at a time.
   *
   * This function fetches all blobs with status PENDING,
   * then processes each blob by attempting to import its data and update its status.
   * Errors during individual blob imports are handled within the importResultBlob function.
   * The function returns the total number of blobs that were attempted to be imported.
   *
   * @returns {Promise<number>} The number of pending result blobs found.
   */
  async function importPendingResultBlobs(): Promise<number> {
    const pendingPromises: Promise<void>[] = [];
    const pendingBlobs = await blobRepository.getPendingBlobs({}, prisma);
    const limit = pLimit(5);
    for (const blob of pendingBlobs) {
      pendingPromises.push(limit(() => importBlob(blob)));
    }
    try {
      await Promise.allSettled(pendingPromises);
    } catch (error) {
      console.error("Error in sync operation:", error);
      throw error;
    }
    return pendingBlobs.length;
  }

  return { enqueueFromMarkdown, importPendingResultBlobs };
})();
