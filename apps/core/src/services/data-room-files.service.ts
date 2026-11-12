import {
  type DataRoom,
  DataRoomEventKind,
  type DataRoomMember,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
} from "@sokosumi/utils";
import JSZip from "jszip";

import { forbidden, notFound, payloadTooLarge } from "@/helpers/error";
import {
  watermarkImage,
  watermarkKindFor,
  watermarkPdf,
  watermarkText,
} from "@/lib/data-room-watermark";
import prisma from "@/lib/db/prisma";
import { driveRead } from "@/lib/drive-blob";
import {
  logDataRoomEvent,
  memberSeesPath,
} from "@/services/data-room-access.service";
import { isInlineRenderable } from "@/services/file-content.service";

/** One file of a room, from the catalog. */
export interface DataRoomFile {
  resourceId: string;
  /** Relative to the room, e.g. "Legal/articles.pdf". */
  path: string;
  name: string;
  sizeBytes: number | null;
  mimeType: string | null;
  updatedAt: Date;
}

/** A row of the room's tree, in the owner's order. */
export interface DataRoomTreeRow {
  kind: "folder" | "file";
  path: string;
  name: string;
  depth: number;
  /** "1", "1.2", "1.2.3": the index a data room is read and cited by. */
  number: string;
  file?: DataRoomFile;
  /** Changed since the viewer's previous visit. */
  isNew: boolean;
}

export function dataRoomPrefix(
  room: Pick<DataRoom, "sourceScope" | "ownerId" | "folderPath">,
): string {
  return room.sourceScope === FileSourceScope.USER
    ? buildUserDriveFolderPrefix(room.ownerId, room.folderPath)
    : buildOrganizationDriveFolderPrefix(room.ownerId, room.folderPath);
}

/** Every live file in the room, from the catalog rather than the store. */
export async function listDataRoomFiles(
  room: Pick<
    DataRoom,
    "workspaceId" | "sourceScope" | "ownerId" | "folderPath"
  >,
): Promise<DataRoomFile[]> {
  const prefix = dataRoomPrefix(room);
  const resources = await prisma.fileResource.findMany({
    where: {
      workspaceId: room.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: room.sourceScope,
      lifecycle: FileResourceLifecycle.ACTIVE,
      tombstonedAt: null,
      sourceId: { startsWith: prefix },
    },
    select: {
      id: true,
      sourceId: true,
      displayName: true,
      sizeBytes: true,
      mimeType: true,
      updatedAt: true,
    },
  });
  return resources.map((resource) => ({
    resourceId: resource.id,
    path: resource.sourceId.slice(prefix.length),
    name: resource.displayName,
    sizeBytes: resource.sizeBytes,
    mimeType: resource.mimeType,
    updatedAt: resource.updatedAt,
  }));
}

/** One file of the room by catalog id, or null when it is not in the room. */
export async function findDataRoomFile(
  room: Pick<
    DataRoom,
    "workspaceId" | "sourceScope" | "ownerId" | "folderPath"
  >,
  resourceId: string,
): Promise<(DataRoomFile & { pathname: string }) | null> {
  const prefix = dataRoomPrefix(room);
  const resource = await prisma.fileResource.findFirst({
    where: {
      id: resourceId,
      workspaceId: room.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: room.sourceScope,
      lifecycle: FileResourceLifecycle.ACTIVE,
      tombstonedAt: null,
      sourceId: { startsWith: prefix },
    },
    select: {
      id: true,
      sourceId: true,
      displayName: true,
      sizeBytes: true,
      mimeType: true,
      updatedAt: true,
    },
  });
  if (!resource) return null;
  return {
    resourceId: resource.id,
    pathname: resource.sourceId,
    path: resource.sourceId.slice(prefix.length),
    name: resource.displayName,
    sizeBytes: resource.sizeBytes,
    mimeType: resource.mimeType,
    updatedAt: resource.updatedAt,
  };
}

interface TreeNode {
  name: string;
  path: string;
  file?: DataRoomFile;
  children: Map<string, TreeNode>;
}

/**
 * The room as the viewer reads it: folders before files at each level, in the
 * owner's order where they set one and by name otherwise, numbered. Files a
 * member may not see are left out, and so is a folder left empty by that.
 */
export function buildDataRoomTree(input: {
  files: readonly DataRoomFile[];
  /** The owner's order: position by path; unlisted paths sort after, by name. */
  order: ReadonlyMap<string, number>;
  member?: Pick<DataRoomMember, "folderPaths" | "previousVisitAt">;
}): DataRoomTreeRow[] {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const file of input.files) {
    if (input.member && !memberSeesPath(input.member, file.path)) continue;
    const segments = file.path.split("/");
    let node = root;
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path, children: new Map() };
        node.children.set(segment, child);
      }
      if (index === segments.length - 1) {
        child.file = file;
        child.name = file.name;
      }
      node = child;
    });
  }

  const since = input.member?.previousVisitAt ?? null;
  const rows: DataRoomTreeRow[] = [];
  const walk = (node: TreeNode, depth: number, prefix: string): boolean => {
    let anyNew = false;
    const children = [...node.children.values()].sort((a, b) => {
      const folderFirst = Number(Boolean(a.file)) - Number(Boolean(b.file));
      if (folderFirst !== 0) return folderFirst;
      const aPos = input.order.get(a.path) ?? Number.POSITIVE_INFINITY;
      const bPos = input.order.get(b.path) ?? Number.POSITIVE_INFINITY;
      if (aPos !== bPos) return aPos - bPos;
      return a.name.localeCompare(b.name);
    });
    children.forEach((child, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      if (child.file) {
        const isNew = since !== null && child.file.updatedAt > since;
        anyNew ||= isNew;
        rows.push({
          kind: "file",
          path: child.path,
          name: child.name,
          depth,
          number,
          file: child.file,
          isNew,
        });
        return;
      }
      const row: DataRoomTreeRow = {
        kind: "folder",
        path: child.path,
        name: child.name,
        depth,
        number,
        isNew: false,
      };
      rows.push(row);
      row.isNew = walk(child, depth + 1, number);
      anyNew ||= row.isNew;
    });
    return anyNew;
  };
  walk(root, 0, "");
  return rows;
}

/** Above this a file is not stamped in memory; the viewer is told why. */
const WATERMARK_MAX_BYTES = 60 * 1024 * 1024;
/** A zip of the room is built in memory, so it has a ceiling. */
const ZIP_MAX_BYTES = 250 * 1024 * 1024;

export interface DataRoomFileContent {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
  name: string;
  inline: boolean;
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** The bytes a viewer gets of one file: stamped when the room says so. */
async function viewerBytes(input: {
  room: Pick<DataRoom, "watermark">;
  member: Pick<DataRoomMember, "email">;
  file: DataRoomFile & { pathname: string };
  now: Date;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}> {
  const read = await driveRead(input.file.pathname);
  if (!read) throw notFound("File not found");
  const kind = input.room.watermark
    ? watermarkKindFor(input.file.mimeType ?? read.contentType)
    : null;
  if (!kind) return read;
  if (read.size > WATERMARK_MAX_BYTES) {
    await read.stream.cancel();
    throw payloadTooLarge(
      "This file is too large to open here. Ask the room's owner for it.",
    );
  }
  const original = new Uint8Array(
    await new Response(read.stream).arrayBuffer(),
  );
  const text = watermarkText(input.member.email, input.now);
  const stamped =
    kind === "pdf"
      ? {
          bytes: await watermarkPdf(original, text),
          contentType: "application/pdf",
        }
      : await watermarkImage(original, text);
  return {
    stream: bytesStream(stamped.bytes),
    contentType: stamped.contentType,
    size: stamped.bytes.byteLength,
  };
}

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Whether the room viewer can show this file in the page. A spreadsheet is
 * read into a table by the viewer itself, so it is served for viewing too,
 * though never inline: the browser cannot render it on its own.
 */
export function viewableInRoom(file: {
  mimeType: string | null;
  name: string;
}) {
  return (
    isInlineRenderable(file.mimeType) ||
    file.mimeType === XLSX_TYPE ||
    file.name.toLowerCase().endsWith(".xlsx")
  );
}

/**
 * One file for a signed-in viewer: only what their access covers, only
 * downloaded when the room allows it, stamped when the room says so, and
 * logged either way.
 */
export async function openDataRoomFile(input: {
  room: DataRoom;
  member: DataRoomMember;
  resourceId: string;
  download: boolean;
  now?: Date;
}): Promise<DataRoomFileContent> {
  const now = input.now ?? new Date();
  const file = await findDataRoomFile(input.room, input.resourceId);
  if (!file || !memberSeesPath(input.member, file.path))
    throw notFound("File not found");
  const viewable = viewableInRoom(file);
  if ((input.download || !viewable) && !input.room.allowDownload)
    throw forbidden(
      viewable
        ? "Downloads are off in this room."
        : "This file opens only as a download, and downloads are off in this room.",
    );
  const content = await viewerBytes({
    room: input.room,
    member: input.member,
    file,
    now,
  });
  await logDataRoomEvent({
    roomId: input.room.id,
    memberId: input.member.id,
    kind: input.download ? DataRoomEventKind.DOWNLOAD : DataRoomEventKind.VIEW,
    path: file.path,
  });
  return {
    ...content,
    name: file.name,
    inline: !input.download && isInlineRenderable(file.mimeType),
  };
}

/**
 * Everything the viewer may see, as one zip, when the room allows downloads.
 * Each file is stamped the way it would be on its own.
 */
export async function zipDataRoom(input: {
  room: DataRoom;
  member: DataRoomMember;
  now?: Date;
}): Promise<{ bytes: Uint8Array; name: string }> {
  const now = input.now ?? new Date();
  if (!input.room.allowDownload)
    throw forbidden("Downloads are off in this room.");
  const files = (await listDataRoomFiles(input.room)).filter((file) =>
    memberSeesPath(input.member, file.path),
  );
  const total = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  if (total > ZIP_MAX_BYTES)
    throw payloadTooLarge(
      "This room is too large to download at once. Download its files one by one.",
    );
  const zip = new JSZip();
  for (const file of files) {
    const content = await viewerBytes({
      room: input.room,
      member: input.member,
      file: { ...file, pathname: `${dataRoomPrefix(input.room)}${file.path}` },
      now,
    });
    zip.file(
      [...file.path.split("/").slice(0, -1), file.name].join("/"),
      new Uint8Array(await new Response(content.stream).arrayBuffer()),
    );
  }
  await logDataRoomEvent({
    roomId: input.room.id,
    memberId: input.member.id,
    kind: DataRoomEventKind.DOWNLOAD_ALL,
  });
  const name =
    input.room.title ?? input.room.folderPath.split("/").at(-1) ?? "data-room";
  return {
    bytes: await zip.generateAsync({ type: "uint8array" }),
    name: `${name}.zip`,
  };
}

/** The owner's order for a room, by path. */
export async function dataRoomOrder(
  roomId: string,
): Promise<Map<string, number>> {
  const entries = await prisma.dataRoomEntry.findMany({
    where: { roomId },
    select: { path: true, position: true },
  });
  return new Map(entries.map((entry) => [entry.path, entry.position]));
}
