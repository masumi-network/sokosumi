import * as Sentry from "@sentry/node";
import {
  buildProjectBriefingPathname,
  buildProjectContextMdPathname,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";

import { getEnv } from "@/config/env";

interface UploadProjectFileOptions {
  content: string;
  projectId: string;
  kind: "briefing" | "context-md";
}

async function uploadProjectFile({
  content,
  projectId,
  kind,
}: UploadProjectFileOptions): Promise<string | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn(
      `Project ${kind} upload skipped: Blob storage is not configured`,
    );
    return null;
  }

  const pathname =
    kind === "briefing"
      ? buildProjectBriefingPathname(projectId)
      : buildProjectContextMdPathname(projectId);

  try {
    const blob = await put(pathname, content, {
      access: "public",
      contentType: "text/markdown; charset=utf-8",
      token,
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    return blob.url;
  } catch (error) {
    console.warn(`Project ${kind} upload failed`, { projectId });
    Sentry.captureException(error, {
      tags: { function: "uploadProjectFile", projectFileKind: kind },
      extra: { projectId },
    });
    return null;
  }
}

export function uploadProjectBriefingFile(
  projectId: string,
  content: string,
): Promise<string | null> {
  return uploadProjectFile({ projectId, content, kind: "briefing" });
}

export function uploadProjectContextMdFile(
  projectId: string,
  content: string,
): Promise<string | null> {
  return uploadProjectFile({ projectId, content, kind: "context-md" });
}
