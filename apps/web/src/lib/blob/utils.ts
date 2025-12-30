import "server-only";

import crypto from "node:crypto";

import * as Sentry from "@sentry/nextjs";
import { put, PutBlobResult } from "@vercel/blob";

import { getEnvSecrets } from "@/config/env.secrets";

export async function uploadFile(
  userId: string,
  inputFile: File,
): Promise<PutBlobResult> {
  const blob = await put(
    `${userId}/${inputFile.name.replace(/ /g, "_")}`,
    inputFile,
    {
      access: "public",
      addRandomSuffix: true,
    },
  );
  return blob;
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
  const env = getEnvSecrets();

  const dataUriRegex =
    /^data:image\/(png|jpg|jpeg|gif|webp|bmp|svg\+xml);base64,/;
  const dataUriMatch = base64Image.match(dataUriRegex);

  if (!dataUriMatch) {
    return null;
  }

  const imageData = Buffer.from(
    base64Image.replace(dataUriRegex, ""),
    "base64",
  );

  const imageHash = crypto.createHash("sha256").update(imageData).digest("hex");

  const mimeType = `image/${dataUriMatch[1]}`;

  try {
    const blob = await put(
      `${env.VERCEL_IMAGES_UPLOAD_DIR}/${imageHash}`,
      imageData,
      {
        access: "public",
        contentType: mimeType,
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
