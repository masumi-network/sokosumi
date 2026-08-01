import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import {
  buildOrganizationDesignMdPathname,
  buildUserDesignMdPathname,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";

import { getEnv } from "@/config/env";

export interface UploadDesignMdContentOptions {
  content: string;
  owner: { kind: "user"; id: string } | { kind: "organization"; id: string };
  extractionId?: string | null;
}

/**
 * Uploads DESIGN.md markdown content to blob storage and returns the public URL,
 * or `null` when a transient storage error prevents the upload.
 *
 * Throws when blob storage is not configured — that is a deployment
 * misconfiguration (a 500-class error), not a transient failure. Callers should
 * map a `null` result to a 503.
 *
 * The filename is content-addressed (sha256) and namespaced by `extractionId`
 * when known, so re-uploading identical content is idempotent. New uploads go
 * under owner-scoped paths (`design-md/users/…` or `design-md/organizations/…`).
 */
export async function uploadDesignMdContent({
  content,
  owner,
  extractionId,
}: UploadDesignMdContentOptions): Promise<string | null> {
  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  const trimmed = content.trim();
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex");
  const fileName = extractionId ? `${extractionId}-${hash}.md` : `${hash}.md`;

  let pathname: string;
  switch (owner.kind) {
    case "user":
      pathname = buildUserDesignMdPathname(owner.id, fileName);
      break;
    case "organization":
      pathname = buildOrganizationDesignMdPathname(owner.id, fileName);
      break;
    default: {
      const _exhaustive: never = owner;
      throw new Error(
        `Unsupported DESIGN.md owner: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }

  try {
    const blob = await put(pathname, trimmed, {
      access: "public",
      // Must stay a non-HTML type: the blob is public and user-authored, so
      // serving it as text/html would turn it into stored XSS.
      contentType: "text/markdown; charset=utf-8",
      token: env.BLOB_READ_WRITE_TOKEN,
      allowOverwrite: true,
      addRandomSuffix: false,
    });
    return blob.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { function: "uploadDesignMdContent" },
    });
    return null;
  }
}
