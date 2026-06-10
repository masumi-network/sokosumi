import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import { put } from "@vercel/blob";

import { STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";

/**
 * Uploads DESIGN.md markdown content to blob storage and returns the public URL,
 * or `null` when the content is empty or storage is not configured.
 *
 * The filename is content-addressed (sha256) and namespaced by `extractionId`
 * when known, so re-uploading identical content is idempotent.
 */
export async function uploadDesignMdContent(
  content: string,
  extractionId?: string | null,
): Promise<string | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "[Blob] BLOB_READ_WRITE_TOKEN not configured, skipping DESIGN.md upload",
    );
    return null;
  }

  const hash = crypto.createHash("sha256").update(trimmed).digest("hex");
  const fileName = extractionId ? `${extractionId}-${hash}.md` : `${hash}.md`;

  try {
    const blob = await put(
      `${STORAGE.DESIGN_MD_UPLOAD_DIR}/${fileName}`,
      trimmed,
      {
        access: "public",
        contentType: "text/markdown; charset=utf-8",
        token: env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
        addRandomSuffix: false,
      },
    );
    return blob.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { function: "uploadDesignMdContent" },
    });
    return null;
  }
}
