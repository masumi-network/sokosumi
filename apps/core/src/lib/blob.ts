import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import { put } from "@vercel/blob";

import { CRYPTO, STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";

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
