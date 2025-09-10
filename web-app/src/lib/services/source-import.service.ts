import "server-only";

import pLimit from "p-limit";

import { uploadFile } from "@/lib/blob";
import { extractFileLikeLinks, extractHttpLinks } from "@/lib/data/markdown";
import { blobRepository, linkRepository, prisma } from "@/lib/db/repositories";
import { isHttpUrl } from "@/lib/utils/file";
import { Blob, BlobOrigin, BlobStatus } from "@/prisma/generated/client";

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
   * - For each file-like link that is a valid HTTP URL, creates a pending output blob in the database,
   *   guessing the file name from the URL if possible.
   * - For each HTTP link that is a valid HTTP URL, upserts a link record in the database.
   * - All operations are performed within a single database transaction for consistency.
   *
   * @param userId - The ID of the user who owns the job and links.
   * @param jobId - The ID of the job associated with the links.
   * @param markdown - The markdown content to scan for links.
   * @returns A Promise that resolves when the operation is complete.
   */
  async function enqueueFromMarkdown(
    userId: string,
    jobId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);
    const httpLinks = extractHttpLinks(markdown);
    if (fileLinks.length === 0 && httpLinks.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const url of fileLinks) {
        if (!isHttpUrl(url)) continue;
        const guessedName = getBasename(url) ?? undefined;
        await blobRepository.createPendingOutputBlob(
          userId,
          jobId,
          url,
          guessedName,
          tx,
        );
      }
      for (const url of httpLinks) {
        if (!isHttpUrl(url)) continue;
        await linkRepository.upsertLink(userId, jobId, url, undefined, tx);
      }
    });
  }

  /**
   * Imports a pending output blob by fetching its source URL, uploading the file,
   * and marking the blob as ready in the database. If the import fails at any step,
   * the blob is marked as failed.
   *
   * Steps:
   * 1. Validates that the blob is an OUTPUT origin and is in PENDING status.
   * 2. Fetches the file from the blob's sourceUrl.
   * 3. Determines the file's content type, size, and suggested filename.
   * 4. Uploads the file using the uploadFile utility.
   * 5. Marks the blob as READY with the uploaded file's metadata.
   * 6. If any error occurs, marks the blob as FAILED.
   *
   * @param blob - The Blob entity to import.
   */
  async function importOutputBlob(blob: Blob): Promise<void> {
    if (blob.origin !== BlobOrigin.OUTPUT) return;
    if (blob.status !== BlobStatus.PENDING) return;

    const sourceUrl: string | null = blob.sourceUrl ?? null;
    if (!sourceUrl) return;
    try {
      const res = await fetch(sourceUrl, { redirect: "follow" });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      const contentType = res.headers.get("content-type");
      const contentLengthHeader = res.headers.get("content-length");
      const sizeNumber = contentLengthHeader
        ? Number(contentLengthHeader)
        : NaN;
      const suggestedName =
        parseContentDispositionFilename(
          res.headers.get("content-disposition"),
        ) ??
        blob.fileName ??
        getBasename(sourceUrl) ??
        "file";

      const arrayBuffer = await res.arrayBuffer();
      const file = new File([arrayBuffer], suggestedName, {
        type: contentType ?? "application/octet-stream",
      });
      const uploaded = await uploadFile(blob.userId, file);
      await blobRepository.markBlobReady(blob.id, {
        fileUrl: uploaded.url,
        mime: contentType,
        size: Number.isFinite(sizeNumber) ? BigInt(sizeNumber) : undefined,
        fileName: suggestedName,
      });
    } catch {
      await blobRepository.markBlobFailed(blob.id);
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
   * Imports all pending output blobs concurrently, up to a maximum of 5 at a time.
   *
   * This function fetches all blobs with status PENDING and origin OUTPUT,
   * then processes each blob by attempting to import its data and update its status.
   * Errors during individual blob imports are handled within the importOutputBlob function.
   * The function returns the total number of blobs that were attempted to be imported.
   *
   * @returns {Promise<number>} The number of pending output blobs found.
   */
  async function importPendingOutputBlobs(): Promise<number> {
    const pendingPromises: Promise<void>[] = [];
    const pendingBlobs = await blobRepository.getPendingOutputBlobs();
    const limit = pLimit(5);
    for (const blob of pendingBlobs) {
      pendingPromises.push(limit(() => importOutputBlob(blob)));
    }
    try {
      await Promise.allSettled(pendingPromises);
    } catch (error) {
      console.error("Error in sync operation:", error);
      throw error;
    }
    return pendingBlobs.length;
  }

  return { enqueueFromMarkdown, importPendingOutputBlobs };
})();
