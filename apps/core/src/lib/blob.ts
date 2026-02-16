import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import {
  head,
  list,
  put,
  type PutBlobResult,
} from "@vercel/blob";

import { CRYPTO, STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";
import type { BlobFile } from "@/schemas/blob-file.schema";

type ListBlobItem = Awaited<ReturnType<typeof list>>["blobs"][number];

function toBlobFile(data: {
  url: string;
  pathname: string;
  downloadUrl: string;
  size: number;
  uploadedAt: Date;
  etag: string;
}): BlobFile {
  return {
    publicUrl: data.url,
    metadata: {
      pathname: data.pathname,
      downloadUrl: data.downloadUrl,
      size: data.size,
      uploadedAt: data.uploadedAt.toISOString(),
      etag: data.etag,
    },
  };
}

function mapPutBlobToFallbackBlobFile(blob: PutBlobResult, file: File): BlobFile {
  return toBlobFile({
    url: blob.url,
    pathname: blob.pathname,
    downloadUrl: blob.downloadUrl,
    size: file.size,
    uploadedAt: new Date(),
    etag: blob.etag,
  });
}

function buildUserUploadPrefix(userId: string): string {
  return `${STORAGE.USER_UPLOADS_DIR}/${userId}/`;
}

function sanitizeUploadFilename(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");

  return sanitized.length > 0 ? sanitized : "file";
}

function mapListBlobToBlobFile(blob: ListBlobItem): BlobFile {
  return toBlobFile({
    url: blob.url,
    pathname: blob.pathname,
    downloadUrl: blob.downloadUrl,
    size: blob.size,
    uploadedAt: blob.uploadedAt,
    etag: blob.etag,
  });
}

export async function uploadUserFile(
  userId: string,
  file: File,
  token: string,
): Promise<BlobFile> {
  const sanitizedFilename = sanitizeUploadFilename(file.name);
  const pathname = `${buildUserUploadPrefix(userId)}${sanitizedFilename}`;

  const blob = await put(pathname, file, {
    access: "public",
    token,
    addRandomSuffix: true,
    allowOverwrite: false,
    contentType: file.type || undefined,
  });

  try {
    const blobHead = await head(blob.url, { token });
    return toBlobFile({
      url: blobHead.url,
      pathname: blobHead.pathname,
      downloadUrl: blobHead.downloadUrl,
      size: blobHead.size,
      uploadedAt: blobHead.uploadedAt,
      etag: blobHead.etag,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        function: "uploadUserFile",
        phase: "head",
      },
    });
    return mapPutBlobToFallbackBlobFile(blob, file);
  }
}

export async function listUserFiles(
  userId: string,
  token: string,
): Promise<BlobFile[]> {
  const prefix = buildUserUploadPrefix(userId);
  const blobs: ListBlobItem[] = [];

  for (let cursor: string | undefined; ; ) {
    const { blobs: pageBlobs, hasMore, cursor: nextCursor } = await list({
      prefix,
      token,
      cursor,
    });
    blobs.push(...pageBlobs);

    if (!hasMore) {
      break;
    }

    if (!nextCursor) {
      throw new Error(
        "Blob list pagination is invalid: hasMore=true without cursor",
      );
    }

    cursor = nextCursor;
  }

  return blobs
    .map(mapListBlobToBlobFile)
    .sort(
      (a, b) =>
        Date.parse(b.metadata.uploadedAt) - Date.parse(a.metadata.uploadedAt),
    );
}

/**
 * Uploads an image to Vercel Blob storage
 * Uses hash-based filename for automatic deduplication
 * If the same hash already exists, it will be overwritten with the same content
 * @param base64Image - Base64 encoded image data URI
 * @returns Upload result URL, or null if invalid input or blob storage not configured
 */
export async function uploadProfileImage(
  base64Image: string,
): Promise<string | null> {
  const env = getEnv();

  const dataUriRegex =
    /^data:image\/(png|jpg|jpeg|gif|webp|bmp|svg\+xml);base64,/;
  const dataUriMatch = base64Image.match(dataUriRegex);

  if (!dataUriMatch) {
    return null;
  }

  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "[Blob] BLOB_READ_WRITE_TOKEN not configured, skipping image upload",
    );
    return null;
  }

  // Extract the base64 encoded image data
  const imageData = Buffer.from(
    base64Image.replace(dataUriRegex, ""),
    "base64",
  );

  const imageHash = crypto
    .createHash(CRYPTO.IMAGE_HASH_ALGORITHM)
    .update(imageData)
    .digest("hex");

  // Extract MIME type from data URI (e.g., "image/jpeg")
  const mimeType = `image/${dataUriMatch[1]}`;

  // Upload new blob with hash as filename
  try {
    const blob = await put(
      `${STORAGE.IMAGES_UPLOAD_DIR}/${imageHash}`,
      imageData,
      {
        access: "public",
        contentType: mimeType,
        token: env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
        addRandomSuffix: false, // Ensure exact filename match for deduplication
      },
    );
    return blob.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        function: "uploadProfileImage",
      },
    });
    return null;
  }
}
