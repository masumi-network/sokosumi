import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import {
  buildCoworkerChatRoomFilePathname,
  buildCoworkerImagePathname,
  buildOrganizationDriveFilePathname,
  buildOrganizationLogoContentHashPathname,
  buildOrganizationLogoPathname,
  buildTaskFilePathname,
  buildUserChatRoomFilePathname,
  buildUserDriveFilePathname,
  buildUserUploadPathname,
  buildUserUploadPrefix,
  buildVendorLogoPathname,
  isOwnedCoworkerImageUrl,
  isOwnedOrganizationDriveFileUrl,
  isOwnedOrganizationLogoUrl,
  isOwnedTaskFileUrl,
  isOwnedUserDriveFileUrl,
  isOwnedVendorLogoUrl,
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
} from "@sokosumi/utils";
import { del, list, put } from "@vercel/blob";

import { CRYPTO, STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  type BlobUploadGrant,
  createBlobUploadGrant,
} from "@/lib/blob-upload-grant";
import type { BlobFile } from "@/schemas/blob-file.schema";
import type { UserFileUploadSession } from "@/schemas/user-file-upload.schema";

type ListBlobItem = Awaited<ReturnType<typeof list>>["blobs"][number];
const USER_UPLOAD_ACCESS = "public" as const;
const USER_UPLOAD_ADD_RANDOM_SUFFIX = true as const;
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

/** User-file direct upload grant (presigned PUT). Same shape as task-file mint. */
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
  const grantInput: Parameters<typeof createBlobUploadGrant>[0] = {
    pathname,
    contentType: file.contentType,
    maximumSizeInBytes: file.size,
    maxSizeBytes: file.maxSizeBytes,
    access: USER_UPLOAD_ACCESS,
    addRandomSuffix: USER_UPLOAD_ADD_RANDOM_SUFFIX,
    token,
  };
  if (file.allowedContentTypes && file.allowedContentTypes.length > 0) {
    grantInput.allowedContentTypes = file.allowedContentTypes;
  }

  return createBlobUploadGrant(grantInput);
}

/**
 * Organization-logo direct upload grant (presigned PUT). Path under
 * `organizations/{orgId}/logos/`. No onUploadCompleted webhook.
 */
export async function createOrganizationLogoUploadSession(
  organizationId: string,
  file: {
    filename: string;
    contentType: string;
    size: number;
    maxSizeBytes: number;
  },
  token: string,
): Promise<BlobUploadGrant> {
  const pathname = buildOrganizationLogoPathname(organizationId, file.filename);

  return createBlobUploadGrant({
    pathname,
    contentType: file.contentType,
    maximumSizeInBytes: file.size,
    maxSizeBytes: file.maxSizeBytes,
    access: "public",
    addRandomSuffix: true,
    token,
    allowedContentTypes: ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  });
}

/**
 * Vendor-logo direct upload grant (presigned PUT). Path under
 * `vendors/{vendorId}/logos/`. No onUploadCompleted webhook.
 */
export async function createVendorLogoUploadSession(
  vendorId: string,
  file: {
    filename: string;
    contentType: string;
    size: number;
    maxSizeBytes: number;
  },
  token: string,
): Promise<BlobUploadGrant> {
  const pathname = buildVendorLogoPathname(vendorId, file.filename);

  return createBlobUploadGrant({
    pathname,
    contentType: file.contentType,
    maximumSizeInBytes: file.size,
    maxSizeBytes: file.maxSizeBytes,
    access: "public",
    addRandomSuffix: true,
    token,
    allowedContentTypes: ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  });
}

/** Task-file direct upload grant (presigned PUT). Same shape as user-file mint. */
export async function createTaskFileUploadSession(
  taskId: string,
  file: {
    filename: string;
    contentType: string;
    size: number;
    maxSizeBytes: number;
  },
  token: string,
  options: {
    uploadedByUserId: string | null;
    uploadedByCoworkerId: string | null;
    callbackUrl: string;
  },
): Promise<BlobUploadGrant> {
  const pathname = buildTaskFilePathname(taskId, file.filename);
  // `size` in tokenPayload is the grant cap echo only; TaskFile.size comes from
  // Blob head on onUploadCompleted.
  const tokenPayload = JSON.stringify({
    taskId,
    name: file.filename,
    mimeType: file.contentType,
    size: file.size,
    uploadedByUserId: options.uploadedByUserId,
    uploadedByCoworkerId: options.uploadedByCoworkerId,
  });

  return createBlobUploadGrant({
    pathname,
    contentType: file.contentType,
    maximumSizeInBytes: file.size,
    maxSizeBytes: file.maxSizeBytes,
    access: "public",
    addRandomSuffix: true,
    token,
    onUploadCompleted: {
      callbackUrl: options.callbackUrl,
      tokenPayload,
    },
  });
}

/**
 * Room chat-file direct upload grant (presigned PUT). Same shape as user-file
 * mint. No onUploadCompleted webhook. Callers put the public URL into message
 * markdown. No ChatFile row.
 */
export async function createChatRoomFileUploadSession(
  owner:
    | { kind: "user"; userId: string }
    | { kind: "coworker"; coworkerId: string },
  roomId: string,
  file: {
    filename: string;
    contentType: string;
    size: number;
    maxSizeBytes: number;
  },
  token: string,
): Promise<BlobUploadGrant> {
  const pathname =
    owner.kind === "user"
      ? buildUserChatRoomFilePathname(owner.userId, roomId, file.filename)
      : buildCoworkerChatRoomFilePathname(
          owner.coworkerId,
          roomId,
          file.filename,
        );

  return createBlobUploadGrant({
    pathname,
    contentType: file.contentType,
    maximumSizeInBytes: file.size,
    maxSizeBytes: file.maxSizeBytes,
    access: "public",
    addRandomSuffix: true,
    token,
  });
}

/**
 * Drive-file direct upload grant (presigned PUT). Path under
 * `drive/users/{userId}/` or `drive/organizations/{orgId}/`.
 * Webhook creates DriveFile row on upload completion.
 */
export async function createDriveFileUploadSession(
  scope: "user" | "organization",
  ownerId: string,
  file: {
    filename: string;
    contentType: string;
    size: number;
    maxSizeBytes: number;
  },
  token: string,
  options: {
    uploadedByUserId: string;
    callbackUrl: string;
  },
): Promise<BlobUploadGrant> {
  const pathname =
    scope === "user"
      ? buildUserDriveFilePathname(ownerId, file.filename)
      : buildOrganizationDriveFilePathname(ownerId, file.filename);

  const tokenPayload = JSON.stringify({
    scope,
    ownerId,
    name: file.filename,
    mimeType: file.contentType,
    size: file.size,
    uploadedByUserId: options.uploadedByUserId,
  });

  return createBlobUploadGrant({
    pathname,
    contentType: file.contentType,
    maximumSizeInBytes: file.size,
    maxSizeBytes: file.maxSizeBytes,
    access: "public",
    addRandomSuffix: true,
    token,
    onUploadCompleted: {
      callbackUrl: options.callbackUrl,
      tokenPayload,
    },
  });
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
 * Persist raw image bytes (a favicon/logo scraped from a site) as a public
 * organization-logo blob under `organizations/{orgId}/logos/{sha256}`, so we
 * own the asset instead of hot-linking an external favicon URL. Returns the
 * public URL, or null when blob storage isn't configured.
 */
export async function uploadOrganizationLogoBytes(params: {
  organizationId: string;
  bytes: ArrayBuffer | Buffer;
  contentType: string;
}): Promise<string | null> {
  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "[Blob] BLOB_READ_WRITE_TOKEN not configured, skipping org logo upload",
    );
    return null;
  }

  const buffer = Buffer.isBuffer(params.bytes)
    ? params.bytes
    : Buffer.from(params.bytes);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const pathname = buildOrganizationLogoContentHashPathname(
    params.organizationId,
    hash,
  );

  try {
    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: params.contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      // The pathname is a content hash under the org prefix, so re-uploading
      // the same icon for the same org (retry) targets an existing blob.
      // Without this, `put` throws on that collision and the caller silently
      // falls back to no logo.
      allowOverwrite: true,
    });
    return blob.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { function: "uploadOrganizationLogoBytes" },
    });
    return null;
  }
}

/**
 * Best-effort delete of a previous organization logo when the URL is owned by
 * that organization (pathname under `organizations/{id}/logos/`). Foreign /
 * invalid / legacy flat URLs are ignored.
 */
export async function deleteOrganizationLogoIfOwned(
  url: string | null | undefined,
  organizationId: string,
): Promise<void> {
  if (!url || !isOwnedOrganizationLogoUrl(url, organizationId)) {
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
        function: "deleteOrganizationLogoIfOwned",
      },
      extra: {
        organizationId,
        url,
      },
    });
  }
}

/**
 * Best-effort delete of a previous vendor logo when the URL is owned by that
 * vendor (pathname under `vendors/{id}/logos/`). Foreign / invalid / legacy
 * URLs are ignored.
 */
export async function deleteVendorLogoIfOwned(
  url: string | null | undefined,
  vendorId: string,
): Promise<void> {
  if (!url || !isOwnedVendorLogoUrl(url, vendorId)) {
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
        function: "deleteVendorLogoIfOwned",
      },
      extra: {
        vendorId,
        url,
      },
    });
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

/**
 * Best-effort delete of a task file blob when the URL is under
 * `tasks/{taskId}/`. Used by user-deletion cleanup.
 */
export async function deleteTaskFileIfOwned(
  url: string | null | undefined,
  taskId: string,
): Promise<void> {
  if (!url || !isOwnedTaskFileUrl(url, taskId)) {
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
        function: "deleteTaskFileIfOwned",
      },
      extra: {
        taskId,
        url,
      },
    });
  }
}

/**
 * Best-effort delete of a user drive file when the URL is under
 * `drive/users/{userId}/`. Used by ACL-checked delete endpoint.
 */
export async function deleteUserDriveFileIfOwned(
  url: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!url || !isOwnedUserDriveFileUrl(url, userId)) {
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
        function: "deleteUserDriveFileIfOwned",
      },
      extra: {
        userId,
        url,
      },
    });
  }
}

/**
 * Best-effort delete of an organization drive file when the URL is under
 * `drive/organizations/{orgId}/`. Used by ACL-checked delete endpoint.
 */
export async function deleteOrganizationDriveFileIfOwned(
  url: string | null | undefined,
  organizationId: string,
): Promise<void> {
  if (!url || !isOwnedOrganizationDriveFileUrl(url, organizationId)) {
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
        function: "deleteOrganizationDriveFileIfOwned",
      },
      extra: {
        organizationId,
        url,
      },
    });
  }
}
