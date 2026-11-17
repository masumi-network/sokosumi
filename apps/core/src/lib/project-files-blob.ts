import { randomBytes } from "node:crypto";
import * as Sentry from "@sentry/node";
import {
  buildProjectBriefingPathname,
  buildProjectContextMdPathname,
} from "@sokosumi/utils";
import { del, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

const PROJECT_FILES_TOKEN_BYTES = 24;

interface UploadProjectFileOptions {
  content: string;
  filesToken: string;
  projectId: string;
  kind: "briefing" | "context-md";
}

async function uploadProjectFile({
  content,
  filesToken,
  projectId,
  kind,
}: UploadProjectFileOptions): Promise<string | null> {
  const blobToken = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    recordCoreWarning(
      { operation: "project_file_upload" },
      {
        message:
          "Skipped a project file upload, because blob storage is not configured",
        why: "BLOB_READ_WRITE_TOKEN is unset",
        fix: "Set BLOB_READ_WRITE_TOKEN to the read-write token of the Vercel Blob store.",
      },
      { projectFile: { kind }, projectId },
    );
    return null;
  }

  const pathname =
    kind === "briefing"
      ? buildProjectBriefingPathname(projectId, filesToken)
      : buildProjectContextMdPathname(projectId, filesToken);

  try {
    const blob = await put(pathname, content, {
      access: "public",
      contentType: "text/markdown; charset=utf-8",
      token: blobToken,
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    return blob.url;
  } catch (error) {
    // Only safe fields: the error can quote the pathname, whose files token
    // is a capability, or the project's content. Sentry keeps the error.
    recordCoreWarning(
      { operation: "project_file_upload" },
      {
        message: "Could not upload a project file",
        why: "Vercel Blob rejected the upload",
        fix: "The file is written again on the project's next update; Sentry has the error.",
      },
      {
        projectFile: { kind },
        projectId,
        failure: messageSafeErrorFields(error),
      },
    );
    Sentry.captureException(error, {
      tags: { function: "uploadProjectFile", projectFileKind: kind },
      extra: { projectId },
    });
    return null;
  }
}

export function generateProjectFilesToken(): string {
  return randomBytes(PROJECT_FILES_TOKEN_BYTES).toString("base64url");
}

export async function ensureProjectFilesToken(
  projectId: string,
  currentFilesToken: string | null | undefined,
): Promise<string | null> {
  if (currentFilesToken) {
    return currentFilesToken;
  }

  const filesToken = generateProjectFilesToken();
  const claimResult = await prisma.project.updateMany({
    where: { id: projectId, filesToken: null },
    data: { filesToken },
  });
  if (claimResult.count === 1) {
    return filesToken;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { filesToken: true },
  });
  return project?.filesToken ?? null;
}

export function uploadProjectBriefingFile(
  projectId: string,
  filesToken: string,
  content: string,
): Promise<string | null> {
  return uploadProjectFile({
    projectId,
    filesToken,
    content,
    kind: "briefing",
  });
}

export function uploadProjectContextMdFile(
  projectId: string,
  filesToken: string,
  content: string,
): Promise<string | null> {
  return uploadProjectFile({
    projectId,
    filesToken,
    content,
    kind: "context-md",
  });
}

export async function deleteProjectBriefingBlob(
  url: string | null | undefined,
): Promise<void> {
  const blobToken = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!url || !blobToken) {
    return;
  }

  try {
    await del(url, { token: blobToken });
  } catch (error) {
    // Only safe fields: the error can quote the URL and its files token.
    recordCoreWarning(
      { operation: "project_file_delete" },
      {
        message: "Could not delete a project briefing file",
        why: "Vercel Blob rejected the deletion",
        fix: "Sentry has the error; the file stays in the store until it is deleted by hand.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    Sentry.captureException(error, {
      tags: { function: "deleteProjectBriefingBlob" },
    });
  }
}
