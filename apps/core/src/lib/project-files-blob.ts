import { randomBytes } from "node:crypto";
import * as Sentry from "@sentry/node";
import {
  buildProjectBriefingPathname,
  buildProjectContextMdPathname,
} from "@sokosumi/utils";
import { del, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

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
    console.warn(
      `Project ${kind} upload skipped: Blob storage is not configured`,
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
    console.warn(`Project ${kind} upload failed`, { projectId });
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
    console.warn("Project briefing blob deletion failed");
    Sentry.captureException(error, {
      tags: { function: "deleteProjectBriefingBlob" },
    });
  }
}
