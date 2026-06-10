import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import { put } from "@vercel/blob";

import { STORAGE } from "@/config/constants";
import { getEnv } from "@/config/env";

/**
 * Uploads DESIGN.md markdown content to blob storage and returns the public URL,
 * or `null` when a transient storage error prevents the upload.
 *
 * Throws when blob storage is not configured — that is a deployment
 * misconfiguration (a 500-class error), not a transient failure. Callers should
 * map a `null` result to a 503.
 *
 * The filename is content-addressed (sha256) and namespaced by `extractionId`
 * when known, so re-uploading identical content is idempotent.
 */
export async function uploadDesignMdContent(
  content: string,
  extractionId?: string | null,
): Promise<string | null> {
  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  const trimmed = content.trim();
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex");
  const fileName = extractionId ? `${extractionId}-${hash}.md` : `${hash}.md`;

  try {
    const blob = await put(
      `${STORAGE.DESIGN_MD_UPLOAD_DIR}/${fileName}`,
      trimmed,
      {
        access: "public",
        // Must stay a non-HTML type: the blob is public and user-authored, so
        // serving it as text/html would turn it into stored XSS.
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
