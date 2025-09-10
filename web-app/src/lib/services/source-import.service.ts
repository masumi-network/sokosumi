import "server-only";

import pLimit from "p-limit";

import { uploadFile } from "@/lib/blob";
import { extractFileLikeLinks, extractHttpLinks } from "@/lib/data/markdown";
import { blobRepository, linkRepository, prisma } from "@/lib/db/repositories";
import { isHttpUrl } from "@/lib/utils/file";
import { Blob } from "@/prisma/generated/client";

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
   * Extract file-like links from markdown and enqueue pending blob records.
   * Deduplicates per job on sourceUrl.
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
   * Process a single blob: download from sourceUrl and upload to public blob.
   * Uses streaming via fetch and File API.
   */
  async function importOne(blob: Blob): Promise<void> {
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
   * Import up to `limit` pending output blobs.
   */
  async function importPendingOutputBlobs(): Promise<number> {
    const pendingPromises: Promise<void>[] = [];
    const pendingBlobs = await blobRepository.getPendingOutputBlobs();
    const limit = pLimit(5);
    for (const blob of pendingBlobs) {
      pendingPromises.push(limit(() => importOne(blob)));
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
