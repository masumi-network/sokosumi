import {
  buildTaskFilePathname,
  clampTaskFileName,
  resolveTaskFileContentType,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";
import prisma from "@/lib/db/prisma";
import { isInDataRoom } from "@/lib/drive-blob";
import {
  FILE_CHUNK_OVERLAP_CHARS,
  FILE_CHUNK_TARGET_CHARS,
  joinExtractedChunks,
} from "@/lib/files/extraction";
import { adoptDriveStoreIfPending } from "@/services/file-backfill.service";
import { downloadBlob } from "@/services/file-index.service";
import { loadLiveResources, searchFiles } from "@/services/file-search.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import {
  dataRoomRefusal,
  isTextMimeType,
  MAX_DIRECT_READ_BYTES,
  readDriveText,
} from "./drive-reading";
import { type RuntimeOperations } from "./operations";
import { TASK_TEXT_MAX_CHARS } from "./task-policy";

/** Searches the owner's Drive, or lists its newest files. */
export async function listFiles(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { query?: string; limit?: number },
) {
  const drive = await runtime.ownerDrive(authorized);
  // Files from before the catalog are adopted on visits, as the Drive
  // search route does; a failure here must not fail the search.
  await adoptDriveStoreIfPending(drive.key);
  const query = input.query?.trim() || null;
  const { items } = await searchFiles({
    workspaceId: drive.key.workspaceId,
    actor: drive.actor,
    query,
    filters: {},
    sortBy: query ? "relevance" : "modified",
    sortOrder: "desc",
    cursor: null,
    limit: input.limit ?? 20,
  });
  return {
    files: items.map((file) => ({
      id: file.id,
      name: file.displayName,
      type: file.mimeType,
      size: file.sizeBytes,
      updatedAt: file.updatedAt,
      category: file.category?.displayName ?? null,
      tags: file.tags.map((tag) => tag.displayName),
      folder: file.folderPath,
      passage: file.snippet?.text.slice(0, 300) ?? null,
      extraction: file.extractionState,
    })),
  };
}

/** The text the catalog extracted from one Drive file. */
/**
 * The text of attached files, appended to a brief or comment. A Coworker
 * works from a Task's text: Hannah saw neither the Task's file list nor
 * the attachment the bot made, and asked three times for the brief.
 */
export async function withInlineFiles(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  text: string,
  fileIds: readonly string[] | undefined,
): Promise<string> {
  let room = TASK_TEXT_MAX_CHARS - text.length;
  const parts = [text];
  for (const fileId of new Set(fileIds ?? [])) {
    if (room < 200) break;
    const file = await runtime
      .readFile(authorized, { fileId })
      .catch(() => null);
    if (!file?.text) continue;
    const header = `\n\n--- ${file.name} ---\n`;
    const body = file.text.slice(0, room - header.length - 40);
    parts.push(
      header +
        body +
        (body.length < file.text.length
          ? "\n[… cut; the full file is attached]"
          : ""),
    );
    room -= header.length + body.length + 40;
  }
  return parts.join("");
}

/**
 * Copies Drive files onto a Task as its inputs. A Coworker reads the Task,
 * not the owner's Files: "review index.html in your Files" left Hannah
 * with nothing to open. Called after the action that proved write access.
 */
export async function attachDriveFiles(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  taskId: string,
  fileIds: readonly string[],
) {
  const drive = await runtime.ownerDrive(authorized);
  const files = await loadLiveResources({
    workspaceId: drive.key.workspaceId,
    actor: drive.actor,
    resourceIds: [...new Set(fileIds)],
  });
  const attached: { fileId: string; name: string }[] = [];
  const skipped: { fileId: string; reason: string }[] = [];
  for (const fileId of new Set(fileIds)) {
    const file = files.find((candidate) => candidate.id === fileId);
    if (!file) {
      skipped.push({
        fileId,
        reason: "not found; use an id from list_files",
      });
      continue;
    }
    if (
      file.sourceKind === "DRIVE_UPLOAD" &&
      (await isInDataRoom(file.sourceId))
    ) {
      skipped.push({ fileId, reason: dataRoomRefusal(file.displayName) });
      continue;
    }
    const name = clampTaskFileName(file.displayName);
    // A page the bot built is attached as its source text: Task files are
    // public blobs, and served as HTML they would run in a reader's browser.
    const contentType =
      resolveTaskFileContentType(name, file.mimeType ?? "") ??
      (isTextMimeType(file.mimeType)
        ? resolveTaskFileContentType(name, "text/plain")
        : null);
    const bytes =
      file.sourceKind === "DRIVE_UPLOAD" && contentType
        ? await downloadBlob(file.sourceId)
        : null;
    if (!bytes || !contentType) {
      skipped.push({
        fileId,
        reason: "this kind of file cannot be attached",
      });
      continue;
    }
    const blob = await put(
      buildTaskFilePathname(taskId, name),
      Buffer.from(bytes),
      { access: "public", contentType, addRandomSuffix: true },
    );
    await prisma.taskFile.upsert({
      where: { taskId_fileUrl: { taskId, fileUrl: blob.url } },
      create: {
        taskId,
        name,
        fileUrl: blob.url,
        mimeType: contentType,
        size: BigInt(bytes.byteLength),
        uploadedBySokoBotId: authorized.turn.sokoBotId,
      },
      update: {},
    });
    attached.push({ fileId, name });
  }
  return { attached, ...(skipped.length ? { skipped } : {}) };
}

/** A CSV as uploaded; extracted search text may not keep its rows intact. */
export async function readCsvFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  fileId: string,
) {
  const text = await readDriveText(await runtime.ownerFile(authorized, fileId));
  if (text === null)
    throw new SokoBotRuntimeValidationError(
      `Import reads an uploaded CSV text file of up to ${MAX_DIRECT_READ_BYTES / 1000} KB from the owner's Files; for other files use the Newsletter's Subscribers page`,
    );
  return text;
}

export async function readFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { fileId: string; maxChars?: number },
) {
  const file = await runtime.ownerFile(authorized, input.fileId);
  const limit = input.maxChars ?? 20_000;
  // Enough chunks to fill the limit, and one more to know there is more.
  const needed = Math.ceil(
    limit / (FILE_CHUNK_TARGET_CHARS - FILE_CHUNK_OVERLAP_CHARS),
  );
  const chunks = await prisma.fileChunk.findMany({
    where: {
      version: { resourceId: file.id, revision: file.contentRevision },
    },
    orderBy: { ordinal: "asc" },
    take: needed + 1,
    select: { text: true },
  });
  const indexed = joinExtractedChunks(chunks.slice(0, needed));
  const moreIndexed = chunks.length > needed;
  const direct = indexed ? null : await readDriveText(file);
  const text = indexed || direct || "";
  return {
    id: file.id,
    name: file.displayName,
    type: file.mimeType,
    text: text.slice(0, limit),
    truncated: text.length > limit || moreIndexed,
    ...(direct
      ? {
          note: "Read from the file itself; search has not indexed it yet.",
        }
      : text
        ? {}
        : {
            note:
              file.extractionState === "PENDING" ||
              file.extractionState === "RUNNING"
                ? "The file is still being processed; its text is not ready yet."
                : `No text was extracted${file.extractionReason ? ` (${file.extractionReason})` : ""}.`,
          }),
  };
}
