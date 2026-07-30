import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";

/**
 * Absolute callback URL for Vercel Blob `onUploadCompleted`.
 *
 * Prefer `VERCEL_BLOB_CALLBACK_URL` (tunnel / explicit public Core host), then
 * the Core public base from Better Auth / Vercel system URLs.
 */
export function resolveBlobUploadCallbackUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const env = getEnv();

  if (env.VERCEL_BLOB_CALLBACK_URL) {
    return `${env.VERCEL_BLOB_CALLBACK_URL.replace(/\/$/, "")}${normalizedPath}`;
  }

  // Vercel runtime may inject this without going through our Zod env (docs).
  const vercelBlobCallback = process.env.VERCEL_BLOB_CALLBACK_URL;
  if (vercelBlobCallback) {
    return `${vercelBlobCallback.replace(/\/$/, "")}${normalizedPath}`;
  }

  return `${getBetterAuthPublicBaseUrl().replace(/\/$/, "")}${normalizedPath}`;
}

/** Path Blob calls after a task-file presigned PUT completes. */
export const TASK_FILE_UPLOAD_COMPLETED_PATH =
  "/v1/webhooks/tasks/files/uploaded";
