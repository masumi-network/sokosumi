import { BlobStatus } from "@sokosumi/database";
import { ssrfSafeFetch } from "@sokosumi/net";
import {
  buildJobBlobPathname,
  buildTaskFilePathname,
  FILE_UPLOAD_MAX_SIZE_BYTES,
  getUrlBasename,
  isUnexpectedHtmlImport,
  resolveDownloadableFileUrl,
} from "@sokosumi/utils";
import { head, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const MAX_CONCURRENT_IMPORTS = 5;
const MAX_IMPORT_SIZE_BYTES = FILE_UPLOAD_MAX_SIZE_BYTES;

interface ImportPendingResultBlobsOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
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

  const blob = await prisma.blob.findUnique({
    where: { id: blobId },
    include: {
      event: {
        select: { jobId: true },
      },
    },
  });

  if (!blob || blob.status !== BlobStatus.PENDING) {
    return;
  }

  const jobId = blob.event?.jobId;
  if (!jobId) {
    await prisma.blob.update({
      where: { id: blob.id },
      data: {
        status: BlobStatus.FAILED,
      },
    });
    return;
  }

  try {
    const abortSignal = createImportAbortSignal(options);
    // SSRF guard: validate the source URL (and every redirect hop) against
    // private/loopback/link-local/metadata addresses before fetching. The
    // result is uploaded to a public blob store, so an unguarded fetch on a
    // URL derived from untrusted job output would be an SSRF + exfiltration
    // primitive.
    // A link to a file and a link to a *page about* a file both end in
    // `.md`. Resolve a page link to GitHub's own download route, which knows
    // where the bytes live (including Git LFS). The recorded sourceUrl keeps
    // what the job actually emitted; only the fetch target is resolved.
    const downloadUrl = resolveDownloadableFileUrl(blob.sourceUrl);
    const response = await ssrfSafeFetch(downloadUrl, {
      signal: abortSignal,
      maxResponseBytes: MAX_IMPORT_SIZE_BYTES,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch blob source: ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const responseFileName = parseContentDispositionFilename(
      response.headers.get("content-disposition"),
    );
    const suggestedName =
      responseFileName ?? blob.name ?? getUrlBasename(blob.sourceUrl) ?? "file";

    // A web page arriving under a document's name is a failed import, not a
    // document whose contents happen to be someone's navigation menu.
    //
    // Judged against what we already knew this file was — the enqueued name
    // and the link the job emitted — as well as what the response calls
    // itself. A response cannot clear itself by answering
    // `Content-Disposition: filename="login.html"`.
    if (
      isUnexpectedHtmlImport({
        contentType,
        fileNames: [
          blob.name,
          getUrlBasename(blob.sourceUrl),
          responseFileName,
        ],
      })
    ) {
      throw new Error(`Refusing to import an HTML page as ${suggestedName}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const sourceFile = new File([arrayBuffer], suggestedName, {
      type: contentType ?? "application/octet-stream",
    });

    const blobToken = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
    }

    const pathname = buildJobBlobPathname(jobId, suggestedName);
    const uploadResult = await put(pathname, sourceFile, {
      access: "public",
      addRandomSuffix: true,
      abortSignal,
      token: blobToken,
    });
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

async function importTaskFile(
  taskFileId: string,
  options: ImportPendingResultBlobsOptions,
): Promise<void> {
  if (!shouldContinueSync(options)) {
    return;
  }

  const taskFile = await prisma.taskFile.findUnique({
    where: { id: taskFileId },
    include: {
      task: {
        select: { id: true },
      },
    },
  });

  if (!taskFile || taskFile.status !== "PENDING" || !taskFile.sourceUrl) {
    return;
  }

  const taskId = taskFile.task.id;

  try {
    const abortSignal = createImportAbortSignal(options);
    // SSRF guard: validate the source URL against private addresses
    const downloadUrl = resolveDownloadableFileUrl(taskFile.sourceUrl);
    const response = await ssrfSafeFetch(downloadUrl, {
      signal: abortSignal,
      maxResponseBytes: MAX_IMPORT_SIZE_BYTES,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task file source: ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const responseFileName = parseContentDispositionFilename(
      response.headers.get("content-disposition"),
    );
    const suggestedName =
      responseFileName ??
      taskFile.name ??
      getUrlBasename(taskFile.sourceUrl) ??
      "file";

    if (
      isUnexpectedHtmlImport({
        contentType,
        fileNames: [
          taskFile.name,
          getUrlBasename(taskFile.sourceUrl),
          responseFileName,
        ],
      })
    ) {
      throw new Error(`Refusing to import an HTML page as ${suggestedName}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const sourceFile = new File([arrayBuffer], suggestedName, {
      type: contentType ?? "application/octet-stream",
    });

    const blobToken = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
    }

    const pathname = buildTaskFilePathname(taskId, suggestedName);
    const uploadResult = await put(pathname, sourceFile, {
      access: "public",
      addRandomSuffix: true,
      abortSignal,
      token: blobToken,
    });
    const blobMetadata = await head(uploadResult.url, {
      abortSignal,
      token: blobToken,
    });

    await prisma.taskFile.update({
      where: { id: taskFile.id },
      data: {
        fileUrl: uploadResult.url,
        mimeType: blobMetadata.contentType,
        name: suggestedName,
        size: BigInt(blobMetadata.size),
        status: "READY",
      },
    });
  } catch (error) {
    if (!shouldContinueSync(options) && isAbortLikeError(error)) {
      // Keep the task file pending so a future sync run can retry it.
      return;
    }

    await prisma.taskFile.update({
      where: { id: taskFile.id },
      data: {
        status: "FAILED",
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

  const pendingTaskFiles = await prisma.taskFile.findMany({
    where: { status: "PENDING", origin: "TASK_OUTPUT" },
    orderBy: { createdAt: "asc" },
  });

  const totalPending = pendingBlobs.length + pendingTaskFiles.length;

  let nextPendingBlobIndex = 0;
  let nextPendingTaskFileIndex = 0;

  const workerCount = Math.min(MAX_CONCURRENT_IMPORTS, totalPending);
  const workers = Array.from({ length: workerCount }, () =>
    (async () => {
      while (shouldContinueSync(options)) {
        // Alternate between blobs and task files for fair processing
        const blob = pendingBlobs[nextPendingBlobIndex];
        const taskFile = pendingTaskFiles[nextPendingTaskFileIndex];

        if (!blob && !taskFile) {
          return;
        }

        if (
          blob &&
          (!taskFile || nextPendingBlobIndex <= nextPendingTaskFileIndex)
        ) {
          nextPendingBlobIndex += 1;
          await importBlob(blob.id, options);
        } else if (taskFile) {
          nextPendingTaskFileIndex += 1;
          await importTaskFile(taskFile.id, options);
        }
      }
    })(),
  );

  await Promise.allSettled(workers);

  return totalPending;
}

export const sourceImportSyncService = {
  importPendingResultBlobs,
};
