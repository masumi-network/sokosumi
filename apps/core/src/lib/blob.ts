import crypto from "node:crypto";

import { put, type PutBlobResult } from "@vercel/blob";

import { STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";

/**
 * Uploads an image to Vercel Blob storage
 * @param data - Buffer or Blob containing the image data
 * @param contentType - MIME type of the image (e.g., "image/jpeg")
 * @returns Upload result with URL and metadata, or null if blob storage is not configured
 */
export async function uploadImage(
  data: Buffer | Blob,
  contentType?: string,
): Promise<PutBlobResult> {
  const env = getEnv();

  // Skip upload if Blob storage is not configured
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "[Blob] BLOB_READ_WRITE_TOKEN not configured, skipping image upload",
    );
    throw new Error("BLOB_READ_WRITE_TOKEN not configured");
  }

  const blob = await put(
    `${STORAGE.IMAGES_UPLOAD_DIR}/${crypto.randomUUID()}`,
    data,
    {
      access: "public",
      contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
    },
  );

  return blob;
}
