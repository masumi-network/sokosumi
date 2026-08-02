import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const JOB_BLOBS_DIR = "jobs";

/**
 * Prefix for job-owned result blobs.
 * Example: `jobs/{jobId}/`
 */
export function buildJobBlobPrefix(jobId: string): string {
  return `${JOB_BLOBS_DIR}/${jobId}/`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `jobs/{jobId}/hello_world.txt`
 */
export function buildJobBlobPathname(jobId: string, fileName: string): string {
  return `${buildJobBlobPrefix(jobId)}${sanitizeUserUploadFilename(fileName)}`;
}
