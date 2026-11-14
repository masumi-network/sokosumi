import { FileSourceKind } from "@sokosumi/database";
import {
  buildOrganizationDriveFolderPrefix,
  CHAT_ROOM_FILE_MAX_SIZE_BYTES,
  parseChatRoomFileUrl,
  resolveUserUploadContentType,
  socialPostMediaKindForMime,
} from "@sokosumi/utils";
import { head } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";
import { moveDriveFile } from "@/helpers/drive-file-move";
import prisma from "@/lib/db/prisma";
import {
  driveDel,
  driveExists,
  driveHead,
  drivePut,
  isInDataRoom,
  publicDriveUrl,
} from "@/lib/drive-blob";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
  tombstoneDriveUploadResource,
} from "@/services/file-catalog.service";
import { unsafeSvgReason } from "@/services/soko-bot-svg";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { driveFolderFor } from "./acting-scope";
import {
  dataRoomRefusal,
  isTextMimeType,
  SVG_MIME_TYPE,
} from "./drive-reading";
import { type RuntimeOperations } from "./operations";

export async function newsletterImageFileUrl(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  fileId: string,
) {
  const file = await runtime.ownerFile(authorized, fileId);
  if (
    file.sourceKind !== FileSourceKind.DRIVE_UPLOAD ||
    socialPostMediaKindForMime(file.mimeType ?? "") !== "image"
  )
    throw new SokoBotRuntimeValidationError(
      "Use an image from Files; upload a chat image with upload_file first",
    );
  const url = await publicDriveUrl(file.sourceId);
  if (!url)
    throw new SokoBotRuntimeValidationError(dataRoomRefusal(file.displayName));
  return url;
}

/**
 * Write a text file into the owner's Drive. Core uploads server-side rather
 * than minting a client grant, because a tool call cannot perform the
 * browser's second step; the catalog steps are the same as a human upload,
 * so the file is searchable, tagged and related like any other. Replacing
 * an existing file is a new version of it, as a human re-upload is.
 */
export async function uploadFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    filename: string;
    content?: string;
    attachmentUrl?: string;
    workspacePath?: string;
    uploadedPathname?: string;
    contentType?: string;
    overwrite?: boolean;
    folder?: string;
  },
) {
  const folder = driveFolderFor(input.folder);
  if (input.workspacePath) return runtime.saveWorkspaceFile(authorized, input);
  if (input.attachmentUrl) {
    if (input.content !== undefined)
      throw new SokoBotRefusedUnsentError(
        "Give either content or attachmentUrl, not both",
      );
    return runtime.saveChatAttachment(authorized, {
      filename: input.filename,
      url: input.attachmentUrl,
      overwrite: input.overwrite,
      folder,
    });
  }
  if (input.content === undefined)
    throw new SokoBotRefusedUnsentError(
      "Give the file's text as content, or a chat attachment's link as attachmentUrl",
    );
  const drive = await runtime.ownerDrive(authorized);
  const pathname = folder
    ? drive.pathnameIn(folder, input.filename)
    : drive.pathname(input.filename);
  const contentType = input.contentType ?? "text/markdown";
  // Text only: this tool writes what the model composed, never binary. An
  // SVG is text too: a graphic the bot drew, checked to be markup only.
  if (contentType === SVG_MIME_TYPE) {
    const unsafe = unsafeSvgReason(input.content);
    if (unsafe) throw new SokoBotRefusedUnsentError(unsafe);
  } else if (!isTextMimeType(contentType)) {
    throw new SokoBotRefusedUnsentError(
      "Only text files and SVG graphics can be written with upload_file",
    );
  }
  // A reused name must not silently replace an owner's file: replacing one
  // takes an explicit `overwrite`, and only a text file can be replaced.
  const existing = await driveHead(pathname);
  if (existing && !input.overwrite) {
    throw new SokoBotRefusedUnsentError(
      `A file named "${input.filename}" already exists. To replace its content, call upload_file again with overwrite: true; to keep it, choose another name.`,
    );
  }
  const existingType = existing ? existing.contentType : null;
  if (
    existing &&
    !isTextMimeType(existingType) &&
    !(existingType === SVG_MIME_TYPE && contentType === SVG_MIME_TYPE)
  ) {
    throw new SokoBotRefusedUnsentError(
      `"${input.filename}" is not a text file, so upload_file cannot replace it; choose another name`,
    );
  }
  const key = { ...drive.key, pathname };
  const sizeBytes = Buffer.byteLength(input.content, "utf8");
  const displayName = pathname.split("/").pop() ?? input.filename;
  await reserveDriveUploadResource({
    key,
    displayName,
    mimeType: contentType,
    sizeBytes,
  });
  await drivePut(pathname, input.content, {
    contentType,
    addRandomSuffix: false,
    allowOverwrite: Boolean(existing),
  });
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes,
    mimeType: contentType,
  });
  nudgeFileIndexing();
  // The blob URL is public and never handed out: anyone holding it could
  // read the file without signing in. The file page checks access.
  return {
    id: activated?.resourceId ?? null,
    filename: displayName,
    replaced: Boolean(existing),
    link: activated ? `/drive/files/${activated.resourceId}` : null,
    size: sizeBytes,
    folder: folder || null,
    // Where the owner finds it, stated so a reply cannot claim elsewhere.
    savedTo:
      drive.key.scope === "organization"
        ? "Files in this organization's workspace, visible to its members"
        : "Files in the owner's personal workspace",
  };
}

export async function moveFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { fileId: string; folder: string },
  toolCallId: string,
) {
  const folder = driveFolderFor(input.folder);
  const { drive, resource } = await runtime.ownerDriveFile(
    authorized,
    input.fileId,
  );
  if (
    drive.key.scope === "organization" &&
    (await isInDataRoom(
      buildOrganizationDriveFolderPrefix(drive.key.ownerId, folder),
    ))
  )
    throw new SokoBotRefusedUnsentError(
      `"${folder}" is a data room; only the people let into it put files there`,
    );
  try {
    await moveDriveFile({
      sourcePathname: resource.sourceId,
      targetFolderPath: folder,
      scope: drive.key.scope,
      ownerId: drive.key.ownerId,
      workspaceId: drive.key.workspaceId,
    });
  } catch (error) {
    if (error instanceof HTTPException && error.status < 500)
      throw new SokoBotRefusedUnsentError(error.message);
    throw error;
  }
  return runtime.commitReceipt(authorized, toolCallId, resource.id, {
    id: resource.id,
    filename: resource.displayName,
    folder: folder || null,
    link: `/drive/files/${resource.id}`,
  });
}

/** Deleting is for good, so only on the owner's own word in their chat. */
export async function deleteFile(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { fileId: string },
  toolCallId: string,
) {
  const turn = authorized.turn;
  if (
    authorized.reader.sharedScope ||
    turn.source !== "CHAT" ||
    turn.chainDepth > 0 ||
    authorized.askedByKind === "ASSISTANT"
  )
    throw new SokoBotRefusedUnsentError(
      "Files are deleted only when your owner asks in their chat with you. Ask them, or move it with move_file.",
    );
  const { drive, resource } = await runtime.ownerDriveFile(
    authorized,
    input.fileId,
  );
  await driveDel([resource.sourceId]);
  await tombstoneDriveUploadResource({
    workspaceId: drive.key.workspaceId,
    scope: drive.key.scope,
    pathname: resource.sourceId,
  });
  return runtime.commitReceipt(authorized, toolCallId, resource.id, {
    id: resource.id,
    filename: resource.displayName,
    deleted: true,
  });
}

/**
 * Copy a file someone attached in chat into the owner's Drive. Chat
 * attachments live under the sender's chat prefix, out of reach of
 * list_files and the Social tools, so "post these screenshots" had no way
 * to use them. Only a link posted in a room both the bot and its owner are
 * in qualifies, so a link cannot pull in an arbitrary file.
 */
export async function saveChatAttachment(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    filename: string;
    url: string;
    overwrite?: boolean;
    folder: string;
  },
) {
  const file = parseChatRoomFileUrl(input.url);
  if (!file)
    throw new SokoBotRefusedUnsentError(
      "That link is not a file attached in a Sokosumi chat",
    );
  const room = await runtime.requireChatMembership(authorized, file.roomId);
  const posted = await prisma.chatRoomMessage.findFirst({
    where: {
      roomId: room.id,
      deletedAt: null,
      content: { contains: input.url },
      // The owner must be in the room too; acting for nobody, the bot's
      // own membership above is the whole check.
      ...(authorized.turn.actingUserId === null
        ? {}
        : {
            room: {
              userMembers: {
                some: { userId: authorized.turn.actingUserId },
              },
            },
          }),
    },
    select: { id: true },
  });
  if (!posted)
    throw new SokoBotRefusedUnsentError(
      "That attachment was not posted in a chat you and your owner are in",
    );
  const meta = await head(input.url);
  if (meta.size > CHAT_ROOM_FILE_MAX_SIZE_BYTES)
    throw new SokoBotRefusedUnsentError("That attachment is too large");
  return runtime.saveFileBytes(authorized, {
    filename: input.filename,
    folder: input.folder,
    overwrite: input.overwrite,
    contentType: meta.contentType,
    read: async () => {
      const response = await fetch(meta.url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok)
        throw new SokoBotRuntimeValidationError(
          "The attachment could not be read; try again",
        );
      return Buffer.from(await response.arrayBuffer());
    },
  });
}

/** Saves a file's bytes into the owner's Files; `read` runs once the name is free. */
export async function saveFileBytes(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    filename: string;
    folder: string;
    overwrite?: boolean;
    contentType: string;
    read: () => Promise<Buffer>;
  },
) {
  const contentType =
    resolveUserUploadContentType(input.filename, input.contentType) ??
    input.contentType;
  const drive = await runtime.ownerDrive(authorized);
  const pathname = input.folder
    ? drive.pathnameIn(input.folder, input.filename)
    : drive.pathname(input.filename);
  const displayName = pathname.split("/").pop() ?? input.filename;
  const existing = await driveExists(pathname);
  if (existing && !input.overwrite)
    throw new SokoBotRefusedUnsentError(
      `A file named "${input.filename}" already exists. To replace it, call upload_file again with overwrite: true; to keep it, choose another name.`,
    );
  const bytes = await input.read();
  const key = { ...drive.key, pathname };
  await reserveDriveUploadResource({
    key,
    displayName,
    mimeType: contentType,
    sizeBytes: bytes.byteLength,
  });
  await drivePut(pathname, bytes, {
    contentType,
    addRandomSuffix: false,
    allowOverwrite: existing,
  });
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes: bytes.byteLength,
    mimeType: contentType,
  });
  nudgeFileIndexing();
  return {
    id: activated?.resourceId ?? null,
    filename: displayName,
    replaced: existing,
    link: activated ? `/drive/files/${activated.resourceId}` : null,
    size: bytes.byteLength,
    folder: input.folder || null,
    savedTo:
      drive.key.scope === "organization"
        ? "Files in this organization's workspace, visible to its members"
        : "Files in the owner's personal workspace",
  };
}
