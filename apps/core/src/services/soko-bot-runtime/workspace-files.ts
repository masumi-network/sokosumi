import { randomUUID } from "node:crypto";
import { FileSourceKind } from "@sokosumi/database";
import { SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES } from "@sokosumi/soko-bot";
import { copy, del, head } from "@vercel/blob";
import { getEnv } from "@/config/env";
import { createBlobUploadGrant } from "@/lib/blob-upload-grant";
import prisma from "@/lib/db/prisma";
import {
  driveReadUrl,
  driveWriteStore,
  publicDriveStore,
  transferBetweenStores,
} from "@/lib/drive-blob";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  speakVoiceover,
  VoiceoverRefusedError,
} from "@/lib/soko-bot/voiceover";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
  WORKSPACE_UPLOAD_GRANTED_EVENT,
} from "../soko-bot-runtime.service";
import { driveFolderFor } from "./acting-scope";
import { withUniqueSuffix, workspaceUploadType } from "./drive-reading";
import { type RuntimeOperations } from "./operations";

/**
 * A one-time address for a file the bot made in its sandbox (a video cut
 * with ffmpeg or Remotion, a rendered image): the sandbox puts the bytes
 * there itself, so they never pass through Core, and upload_file then adds
 * the file to Files. The address is new every time and refuses a second
 * write, so nothing already shared or approved can change under it.
 */
export async function grantWorkspaceUpload(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    filename: string;
    folder?: string;
    contentType?: string;
    size: number;
  },
) {
  if (!authorized.grant.capabilities.includes("upload_file"))
    throw new SokoBotRefusedUnsentError("upload_file is not available here");
  const contentType = workspaceUploadType(input.filename, input.contentType);
  if (input.size <= 0 || input.size > SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES)
    throw new SokoBotRefusedUnsentError(
      `A workspace file must be between 1 byte and ${SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES / 1e6} MB`,
    );
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token)
    throw new SokoBotRuntimeValidationError("File storage is not configured");
  const drive = await runtime.ownerDrive(authorized);
  const folder = driveFolderFor(input.folder);
  const named = folder
    ? drive.pathnameIn(folder, input.filename)
    : drive.pathname(input.filename);
  const extension = /\.[a-z0-9]{1,8}$/i.exec(input.filename)?.[0] ?? "";
  // A staging address: the signed PUT stays usable for minutes, so it must
  // never be where Files keeps the file. saveWorkspaceFile copies it out.
  const grant = await createBlobUploadGrant({
    pathname: `soko-bot-staging/${authorized.turn.id}/${randomUUID()}${extension}`,
    contentType,
    maximumSizeInBytes: input.size,
    maxSizeBytes: SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES,
    access: "public",
    addRandomSuffix: false,
    token,
  });
  return {
    grant,
    displayName: named.split("/").pop() ?? input.filename,
    folder,
    contentType,
  };
}

/**
 * Where the sandbox reads a file from the owner's Files for
 * workspace_import_file: the same files read_file may open, as bytes.
 */
export async function workspaceFileSource(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  fileId: string,
) {
  if (!authorized.grant.capabilities.includes("workspace_import_file"))
    throw new SokoBotRefusedUnsentError(
      "workspace_import_file is not available here",
    );
  const file = await runtime.ownerFile(authorized, fileId);
  if (file.sourceKind !== FileSourceKind.DRIVE_UPLOAD)
    throw new SokoBotRefusedUnsentError(
      "Only files in Files can be copied; a Task's files stay with it",
    );
  if ((file.sizeBytes ?? 0) > SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES)
    throw new SokoBotRefusedUnsentError(
      `${file.displayName} is over ${SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES / 1e6} MB`,
    );
  return {
    // Signed and short-lived for a data room's private file.
    url: await driveReadUrl(file.sourceId),
    name: file.displayName,
    contentType: file.mimeType,
  };
}

/** Speaks text as an mp3 in the owner's Files, with its timing. */
export async function generateVoiceover(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    text: string;
    voice?: string;
    languageCode?: string;
    filename: string;
    folder?: string;
  },
) {
  runtime.refuseCmoRunMedia(authorized);
  const filename = /\.mp3$/i.test(input.filename)
    ? input.filename
    : `${input.filename}.mp3`;
  let voiceover: Awaited<ReturnType<typeof speakVoiceover>>;
  try {
    voiceover = await speakVoiceover(input);
  } catch (error) {
    // Only a refusal is sure to be unbilled; a later failure may have paid.
    if (error instanceof VoiceoverRefusedError)
      throw new SokoBotRefusedUnsentError(error.message);
    throw new SokoBotRuntimeValidationError(
      error instanceof Error ? error.message : "The voice-over failed",
    );
  }
  // Like Jev and routing: on the turn's total, not billed.
  await prisma.sokoBotTurn.update({
    where: { id: authorized.turn.id },
    data: {
      overheadCostUsdMicros: {
        increment: BigInt(Math.round(voiceover.costUsd * 1_000_000)),
      },
    },
  });
  const saved = await runtime.saveFileBytes(authorized, {
    filename,
    folder: driveFolderFor(input.folder),
    contentType: "audio/mpeg",
    read: async () => Buffer.from(voiceover.bytes),
  });
  return {
    ...saved,
    durationSeconds: voiceover.durationSeconds,
    sentences: voiceover.sentences,
  };
}

/**
 * Adds a file the sandbox uploaded through grantWorkspaceUpload to Files.
 * Only an address this turn was granted counts, and only with the type it
 * was granted for. The bytes are copied to a new address only Core writes,
 * so replaying the upload link later changes nothing in Files.
 */
export async function saveWorkspaceFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    workspacePath?: string;
    uploadedPathname?: string;
    content?: string;
    attachmentUrl?: string;
    overwrite?: boolean;
  },
) {
  if (input.content !== undefined || input.attachmentUrl)
    throw new SokoBotRefusedUnsentError(
      "Give one of content, attachmentUrl or workspacePath",
    );
  if (input.overwrite)
    throw new SokoBotRefusedUnsentError(
      "A workspace file is always saved as a new file; choose a new name",
    );
  const granted = input.uploadedPathname
    ? await prisma.sokoBotRuntimeEvent.findFirst({
        where: {
          turnId: authorized.turn.id,
          type: WORKSPACE_UPLOAD_GRANTED_EVENT,
          data: { path: ["pathname"], equals: input.uploadedPathname },
        },
        select: { data: true },
      })
    : null;
  if (!granted || !input.uploadedPathname)
    throw new SokoBotRefusedUnsentError(
      "A workspace file can only be saved from your sandbox",
    );
  const grant = granted.data as {
    displayName: string;
    folder: string;
    contentType: string;
  };
  const blob = await head(input.uploadedPathname).catch(() => null);
  if (!blob || blob.contentType !== grant.contentType)
    throw new SokoBotRefusedUnsentError(
      `${input.workspacePath} did not finish uploading; try again`,
    );
  const drive = await runtime.ownerDrive(authorized);
  const pathname = withUniqueSuffix(
    grant.folder
      ? drive.pathnameIn(grant.folder, grant.displayName)
      : drive.pathname(grant.displayName),
  );
  const key = { ...drive.key, pathname };
  await reserveDriveUploadResource({
    key,
    displayName: grant.displayName,
    mimeType: grant.contentType,
    sizeBytes: blob.size,
  });
  const target = await driveWriteStore(pathname);
  if (target.access === "public")
    await copy(input.uploadedPathname, pathname, {
      access: "public",
      contentType: grant.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  else
    await transferBetweenStores({
      fromPathname: input.uploadedPathname,
      fromStore: publicDriveStore(),
      toPathname: pathname,
      toStore: target,
      contentType: grant.contentType,
    });
  await del(input.uploadedPathname).catch(() => undefined);
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes: blob.size,
    mimeType: grant.contentType,
  });
  nudgeFileIndexing();
  return {
    id: activated?.resourceId ?? null,
    filename: grant.displayName,
    replaced: false,
    link: activated ? `/drive/files/${activated.resourceId}` : null,
    size: blob.size,
    folder: grant.folder || null,
    savedTo:
      drive.key.scope === "organization"
        ? "Files in this organization's workspace, visible to its members"
        : "Files in the owner's personal workspace",
  };
}
