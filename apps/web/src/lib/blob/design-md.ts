import "server-only";

import crypto from "node:crypto";

import * as Sentry from "@sentry/nextjs";
import { buildUserUploadPrefix } from "@sokosumi/utils";
import { put } from "@vercel/blob";

const DESIGN_MD_UPLOAD_DIR = "design-md";
const VERCEL_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

function decodeBlobPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function isAllowedDesignMdBlobUrl(url: string, userId: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }

    if (!parsed.hostname.endsWith(VERCEL_BLOB_HOST_SUFFIX)) {
      return false;
    }

    const pathname = decodeBlobPathname(parsed.pathname);
    const userUploadPrefix = `/${buildUserUploadPrefix(userId)}`;

    return pathname.startsWith(userUploadPrefix);
  } catch {
    return false;
  }
}

export interface UploadDesignMdToBlobInput {
  designMd: string;
  extractionId?: string | number;
}

export async function uploadDesignMdToBlob({
  designMd,
  extractionId,
}: UploadDesignMdToBlobInput): Promise<string | null> {
  const content = designMd.trim();

  if (!content) return null;

  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const fileName =
    extractionId === undefined ? `${hash}.md` : `${extractionId}-${hash}.md`;

  try {
    const blob = await put(`${DESIGN_MD_UPLOAD_DIR}/${fileName}`, content, {
      access: "public",
      contentType: "text/markdown; charset=utf-8",
      allowOverwrite: true,
      addRandomSuffix: false,
    });

    return blob.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        function: "uploadDesignMdToBlob",
      },
    });
    return null;
  }
}
