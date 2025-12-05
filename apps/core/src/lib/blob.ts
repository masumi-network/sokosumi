import crypto from "node:crypto";

import { put, type PutBlobResult } from "@vercel/blob";

import { STORAGE } from "@/config/constants";

/**
 * Uploads an image to Vercel Blob storage
 * @param data - Buffer or Blob containing the image data
 * @param contentType - MIME type of the image (e.g., "image/jpeg")
 * @returns Upload result with URL and metadata
 */
export async function uploadImage(
  data: Buffer | Blob,
  contentType?: string,
): Promise<PutBlobResult> {
  const blob = await put(`${STORAGE.IMAGES_UPLOAD_DIR}/${crypto.randomUUID()}`, data, {
    access: "public",
    contentType,
  });

  return blob;
}
