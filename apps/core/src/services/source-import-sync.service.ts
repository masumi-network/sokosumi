import { BlobStatus } from "@sokosumi/database";
import { ssrfSafeFetch } from "@sokosumi/net";
import { getUrlBasename } from "@sokosumi/utils";
import { head, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const MAX_CONCURRENT_IMPORTS = 5;

interface ImportPendingResultBlobsOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

/** Sanitize filename for blob storage path (matches web's uploadFileForBlob behavior). */
function sanitizePathSegment(name: string): string {
  return name.replace(/ /g, "_");
}

function parseContentDispositionFilename(
  contentDispositionHeader: string | null,
): string | null {
  if (!contentDispositionHeader) {
    return null;
  }

  const match =
    /filename\*=UTF-8''([^;]+)|filename\*=([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(
      contentDispositionHeader,
    );

  const encodedFilename =
    match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? null;

  if (!encodedFilename) {
    return null;
  }

  const filename = encodedFilename.trim().replace(/^"|"$/g, "");

  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function hasTimeRemaining(deadlineMs: number): boolean {
  return Date.now() < deadlineMs;
}

function shouldContinueSync(options: ImportPendingResultBlobsOptions): boolean {
  if (!options.shouldContinue()) {
    return false;
  }

  if (options.abortSignal.aborted) {
    return false;
  }

  return hasTimeRemaining(options.deadlineMs);
}

function createImportAbortSignal(
  options: ImportPendingResultBlobsOptions,
): AbortSignal {
  const remainingMs = options.deadlineMs - Date.now();
  return AbortSignal.any([
    options.abortSignal,
    AbortSignal.timeout(Math.max(1, remainingMs)),
  ]);
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error.name === "BlobRequestAbortedError"
  );
}

async function importBlob(
  blobId: string,
  options: ImportPendingResultBlobsOptions,
): Promise<void> {
  if (!shouldContinueSync(options)) {
    return;
  }

  const blob = await prisma.blob.findUnique({ where: { id: blobId } });

  if (!blob || blob.status !== BlobStatus.PENDING) {
    return;
  }

  try {
    const abortSignal = createImportAbortSignal(options);
    // SSRF guard: validate the source URL (and every redirect hop) against
    // private/loopback/link-local/metadata addresses before fetching. The
    // result is uploaded to a public blob store, so an unguarded fetch on a
    // URL derived from untrusted job output would be an SSRF + exfiltration
    // primitive.
    const response = await ssrfSafeFetch(blob.sourceUrl, {
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch blob source: ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const suggestedName =
      parseContentDispositionFilename(
        response.headers.get("content-disposition"),
      ) ??
      blob.name ??
      getUrlBasename(blob.sourceUrl) ??
      "file";

    const arrayBuffer = await response.arrayBuffer();
    const sourceFile = new File([arrayBuffer], suggestedName, {
      type: contentType ?? "application/octet-stream",
    });

    const blobToken = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
    }

    const pathSegment = sanitizePathSegment(suggestedName);
    const uploadResult = await put(
      `blobs/${blob.id}/${pathSegment}`,
      sourceFile,
      {
        access: "public",
        addRandomSuffix: true,
        abortSignal,
        token: blobToken,
      },
    );
    const blobMetadata = await head(uploadResult.url, {
      abortSignal,
      token: blobToken,
    });

    await prisma.blob.update({
      where: { id: blob.id },
      data: {
        fileUrl: uploadResult.url,
        mimeType: blobMetadata.contentType,
        name: suggestedName,
        size: BigInt(blobMetadata.size),
        status: BlobStatus.READY,
      },
    });
  } catch (error) {
    if (!shouldContinueSync(options) && isAbortLikeError(error)) {
      // Keep the blob pending so a future sync run can retry it.
      return;
    }

    await prisma.blob.update({
      where: { id: blob.id },
      data: {
        status: BlobStatus.FAILED,
      },
    });
  }
}

async function importPendingResultBlobs(
  options: ImportPendingResultBlobsOptions,
): Promise<number> {
  const pendingBlobs = await prisma.blob.findMany({
    where: { status: BlobStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  let nextPendingBlobIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENT_IMPORTS, pendingBlobs.length);
  const workers = Array.from({ length: workerCount }, () =>
    (async () => {
      while (shouldContinueSync(options)) {
        const blob = pendingBlobs[nextPendingBlobIndex];
        nextPendingBlobIndex += 1;

        if (!blob) {
          return;
        }

        await importBlob(blob.id, options);
      }
    })(),
  );

  await Promise.allSettled(workers);

  return pendingBlobs.length;
}

export const sourceImportSyncService = {
  importPendingResultBlobs,
};
