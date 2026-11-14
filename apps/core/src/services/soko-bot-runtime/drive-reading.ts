import { randomUUID } from "node:crypto";
import { resolveUserUploadContentType } from "@sokosumi/utils";
import { downloadBlob } from "@/services/file-index.service";
import { type LiveResource } from "@/services/file-search.service";
import { SokoBotRefusedUnsentError } from "../soko-bot-runtime.service";

/** What a bot is told when a file it chose sits in a data room. */
export function dataRoomRefusal(name: string): string {
  return `"${name}" is in a data room, so it cannot leave Sokosumi this way. Ask your owner to move it out of the room first.`;
}

export const SVG_MIME_TYPE = "image/svg+xml";

/** `a/b/clip.mp4` → `a/b/clip-1f3c9a2b.mp4`: a storage address nobody can take back. */
export function withUniqueSuffix(pathname: string): string {
  const slash = pathname.lastIndexOf("/");
  const dot = pathname.lastIndexOf(".");
  const suffix = randomUUID().slice(0, 8);
  return dot > slash
    ? `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}`
    : `${pathname}-${suffix}`;
}

/** The type of a workspace file upload_file takes: media and PDFs, never markup. */
export function workspaceUploadType(
  filename: string,
  declared?: string,
): string {
  const contentType = resolveUserUploadContentType(filename, declared ?? "");
  if (!contentType || !WORKSPACE_UPLOAD_TYPES.has(contentType))
    throw new SokoBotRefusedUnsentError(
      "A workspace file must be a video (mp4, mov, webm), an image (png, jpg, gif, webp), a PDF or audio (mp3, wav); name it with that extension",
    );
  return contentType;
}

/** What upload_file takes from the bot's workspace: media and PDFs, never markup. */
export const WORKSPACE_UPLOAD_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "audio/mpeg",
  "audio/wav",
]);

export function isTextMimeType(mimeType: string | null): boolean {
  return (
    !!mimeType &&
    (mimeType.startsWith("text/") || mimeType === "application/json")
  );
}

/** Drive text small enough to read whole. */
export const MAX_DIRECT_READ_BYTES = 200_000;

export const DIRECT_READ_ATTEMPTS = 4;

export const DIRECT_READ_RETRY_MS = 5_000;

/**
 * A Drive text file's content, read from the blob itself, for a file search
 * has not indexed yet; null for anything else or when it cannot be read.
 */
export async function readDriveText(
  file: LiveResource,
): Promise<string | null> {
  if (
    file.sourceKind !== "DRIVE_UPLOAD" ||
    !isTextMimeType(file.mimeType) ||
    (file.sizeBytes ?? Number.POSITIVE_INFINITY) > MAX_DIRECT_READ_BYTES
  )
    return null;
  // A pathname written again after a delete answers 404 for up to ~15s.
  for (let attempt = 1; ; attempt++) {
    try {
      const bytes = await downloadBlob(file.sourceId);
      return bytes ? new TextDecoder().decode(bytes) : null;
    } catch {
      if (attempt >= DIRECT_READ_ATTEMPTS) return null;
      await new Promise((resolve) => setTimeout(resolve, DIRECT_READ_RETRY_MS));
    }
  }
}
