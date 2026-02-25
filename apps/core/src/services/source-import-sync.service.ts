import { BlobStatus } from "@sokosumi/database";
import { head, put } from "@vercel/blob";
import pLimit from "p-limit";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const MAX_CONCURRENT_IMPORTS = 5;

/** Sanitize filename for blob storage path (matches web's uploadFileForBlob behavior). */
function sanitizePathSegment(name: string): string {
  return name.replace(/ /g, "_");
}

function getBasename(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const pathnameTail = parsedUrl.pathname.split("/").pop() ?? "";
    return pathnameTail || null;
  } catch {
    return null;
  }
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

async function importBlob(blobId: string): Promise<void> {
  const blob = await prisma.blob.findUnique({ where: { id: blobId } });

  if (!blob || blob.status !== BlobStatus.PENDING) {
    return;
  }

  try {
    const response = await fetch(blob.sourceUrl, { redirect: "follow" });

    if (!response.ok) {
      throw new Error(`Failed to fetch blob source: ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const suggestedName =
      parseContentDispositionFilename(
        response.headers.get("content-disposition"),
      ) ??
      blob.name ??
      getBasename(blob.sourceUrl) ??
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
        token: blobToken,
      },
    );
    const blobMetadata = await head(uploadResult.url, { token: blobToken });

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
  } catch (_error) {
    await prisma.blob.update({
      where: { id: blob.id },
      data: {
        status: BlobStatus.FAILED,
      },
    });
  }
}

async function importPendingResultBlobs(): Promise<number> {
  const pendingBlobs = await prisma.blob.findMany({
    where: { status: BlobStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  const limit = pLimit(MAX_CONCURRENT_IMPORTS);
  const runningImports = pendingBlobs.map((blob) =>
    limit(async () => {
      await importBlob(blob.id);
    }),
  );
  await Promise.allSettled(runningImports);

  return pendingBlobs.length;
}

export const sourceImportSyncService = {
  importPendingResultBlobs,
};
