import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import {
  buildCoworkerImagePathname,
  buildUserUploadPathname,
  buildUserUploadPrefix,
  isOwnedCoworkerImageUrl,
} from "@sokosumi/utils";
import { del, list, put } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

import { CRYPTO, STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";
import type { BlobFile } from "@/schemas/blob-file.schema";
import type { UserFileUploadSession } from "@/schemas/user-file-upload.schema";

type ListBlobItem = Awaited<ReturnType<typeof list>>["blobs"][number];
const USER_UPLOAD_ACCESS = "public" as const;
const USER_UPLOAD_ADD_RANDOM_SUFFIX = true as const;
const USER_UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000;
const IMAGE_DATA_URI_REGEX =
  /^data:image\/(png|jpg|jpeg|gif|webp|bmp|svg\+xml);base64,/i;

/** True when `value` is a supported generated-chat image data URI (case-insensitive scheme and subtype). */
export function isGeneratedChatImageDataUri(value: string): boolean {
  return IMAGE_DATA_URI_REGEX.test(value.trimStart());
}

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

export async function createUserFileUploadSession(
  userId: string,
  file: {
    filename: string;
    contentType: string;
    size: number;
    maxSizeBytes: number;
    allowedContentTypes?: readonly string[];
  },
  token: string,
): Promise<UserFileUploadSession> {
  const pathname = buildUserUploadPathname(userId, file.filename);
  const allowedContentTypes =
    file.allowedContentTypes && file.allowedContentTypes.length > 0
      ? [...file.allowedContentTypes]
      : [file.contentType];
  const clientToken = await generateClientTokenFromReadWriteToken({
    token,
    pathname,
    allowedContentTypes,
    maximumSizeInBytes: file.size,
    validUntil: Date.now() + USER_UPLOAD_SESSION_TTL_MS,
    addRandomSuffix: USER_UPLOAD_ADD_RANDOM_SUFFIX,
  });

  return {
    clientToken,
    access: USER_UPLOAD_ACCESS,
    pathname,
    addRandomSuffix: USER_UPLOAD_ADD_RANDOM_SUFFIX,
    maxSizeBytes: file.maxSizeBytes,
  };
}

export async function listUserUploads(
  userId: string,
  token: string,
): Promise<BlobFile[]> {
  const prefix = buildUserUploadPrefix(userId);
  const blobs: ListBlobItem[] = [];

  for (let cursor: string | undefined; ; ) {
    const {
      blobs: pageBlobs,
      hasMore,
      cursor: nextCursor,
    } = await list({
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
    .map((blob) =>
      toBlobFile({
        url: blob.url,
        pathname: blob.pathname,
        downloadUrl: blob.downloadUrl,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
        etag: blob.etag,
      }),
    )
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

  const dataUriMatch = base64Image.match(IMAGE_DATA_URI_REGEX);

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
    base64Image.replace(IMAGE_DATA_URI_REGEX, ""),
    "base64",
  );

  const imageHash = crypto
    .createHash(CRYPTO.IMAGE_HASH_ALGORITHM)
    .update(imageData)
    .digest("hex");

  // Extract MIME type from data URI (e.g., "image/jpeg"); subtype lowercased for /i regex.
  const mimeType = `image/${dataUriMatch[1]!.toLowerCase()}`;

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

export interface UploadedGeneratedChatImage {
  url: string;
  mediaType: string;
  filename: string;
}

function imageExtensionFromDataUriMatch(match: RegExpMatchArray): string {
  const extension = match[1]!.toLowerCase();
  if (extension === "jpeg") {
    return "jpg";
  }
  if (extension === "svg+xml") {
    return "svg";
  }
  return extension;
}

/**
 * Uploads a generated chat image data URL so persisted assistant messages can
 * reference a small HTTPS file part instead of replaying base64 in text.
 */
export async function uploadGeneratedChatImage(params: {
  dataUrl: string;
  userId: string;
  conversationId: string;
}): Promise<UploadedGeneratedChatImage | null> {
  const env = getEnv();
  const trimmedDataUrl = params.dataUrl.trimStart();
  const dataUriMatch = trimmedDataUrl.match(IMAGE_DATA_URI_REGEX);

  if (!dataUriMatch) {
    return null;
  }

  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "[Blob] BLOB_READ_WRITE_TOKEN not configured, skipping generated chat image upload",
    );
    return null;
  }

  const imageData = Buffer.from(
    trimmedDataUrl.replace(IMAGE_DATA_URI_REGEX, "").replace(/\s/g, ""),
    "base64",
  );
  const imageHash = crypto
    .createHash(CRYPTO.IMAGE_HASH_ALGORITHM)
    .update(imageData)
    .digest("hex");
  const extension = imageExtensionFromDataUriMatch(dataUriMatch);
  const mediaType = `image/${dataUriMatch[1]!.toLowerCase()}`;
  const filename = `generated-${imageHash}.${extension}`;

  try {
    const blob = await put(
      `${STORAGE.IMAGES_UPLOAD_DIR}/generated/${params.userId}/${params.conversationId}/${filename}`,
      imageData,
      {
        access: "public",
        contentType: mediaType,
        token: env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
        addRandomSuffix: false,
      },
    );

    return {
      url: blob.url,
      mediaType,
      filename,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        function: "uploadGeneratedChatImage",
      },
    });
    return null;
  }
}

/**
 * Upload a coworker image to Vercel Blob (public, random suffix).
 * Returns the public URL, or null when blob storage is not configured / put fails.
 */
export async function uploadCoworkerImage(params: {
  coworkerId: string;
  bytes: ArrayBuffer | Buffer | Blob;
  contentType: string;
  filename: string;
}): Promise<string | null> {
  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "[Blob] BLOB_READ_WRITE_TOKEN not configured, skipping coworker image upload",
    );
    return null;
  }

  const pathname = buildCoworkerImagePathname(
    params.coworkerId,
    params.filename,
    params.contentType,
  );

  try {
    const blob = await put(pathname, params.bytes, {
      access: "public",
      contentType: params.contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    });
    return blob.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        function: "uploadCoworkerImage",
      },
    });
    return null;
  }
}

/**
 * Best-effort delete of a previous coworker image when the URL is owned by
 * that coworker (pathname under `coworkers/{id}/`). Foreign / invalid URLs are
 * ignored.
 */
export async function deleteCoworkerImageIfOwned(
  url: string | null | undefined,
  coworkerId: string,
): Promise<void> {
  if (!url || !isOwnedCoworkerImageUrl(url, coworkerId)) {
    return;
  }

  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return;
  }

  try {
    await del(url, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        function: "deleteCoworkerImageIfOwned",
      },
      extra: {
        coworkerId,
        url,
      },
    });
  }
}
