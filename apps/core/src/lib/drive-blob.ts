import { DataRoomStorage, FileSourceScope } from "@sokosumi/database";
import {
  type BlobAccessType,
  BlobNotFoundError,
  del,
  get,
  type HeadBlobResult,
  head,
  issueSignedToken,
  type ListBlobResultBlob,
  list,
  type PutBlobResult,
  type PutCommandOptions,
  presignUrl,
  put,
  rename,
} from "@vercel/blob";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/**
 * Which Blob store a Drive pathname lives in.
 *
 * Drive keeps every file in one **public** store, where an object is served to
 * anyone holding its URL. A data room is a Drive folder whose files live in a
 * second, **private** store instead, so the only way to the bytes is a Core
 * route that checks access first, and taking someone's access away ends it.
 * Vercel fixes public or private per store, not per object, so a room cannot
 * simply flip its files; they move between stores.
 *
 * Every Drive read and write of a pathname goes through this module, which
 * looks up the owner's rooms and routes:
 *
 * - **Writes** go to the store the path belongs in now: private inside a room
 *   that is moving in or private, public everywhere else.
 * - **Reads** look there first and, while the owner has any room, in the other
 *   store second. That fallback is what keeps a file readable while a cron is
 *   still moving a room's bytes, and while a folder move that crosses a room
 *   boundary is half done.
 * - **Listings** inside a private room read the private store; listings that
 *   contain a room read both.
 *
 * Pathnames do not change: a file keeps `FileResource.sourceId` whichever store
 * holds its bytes.
 */

export interface DriveBlobStore {
  access: BlobAccessType;
  token: string;
}

/** A listed blob, with the store it came from. */
export interface DriveListedBlob extends ListBlobResultBlob {
  access: BlobAccessType;
}

export interface DriveListResult {
  blobs: DriveListedBlob[];
  /** Folder prefixes, in `folded` mode. */
  folders: string[];
  cursor?: string;
  hasMore: boolean;
}

export interface DriveRoomRef {
  folderPath: string;
  storage: DataRoomStorage;
}

const SCOPE_SEGMENTS: Record<string, FileSourceScope> = {
  users: FileSourceScope.USER,
  organizations: FileSourceScope.ORGANIZATION,
};

/** The public Drive store. Drive is unavailable without it. */
export function publicDriveStore(): DriveBlobStore {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) throw serviceUnavailable("Blob storage is not configured");
  return { access: "public", token };
}

/** The private data-room store, when this deployment has one. */
export function privateDriveStore(): DriveBlobStore | null {
  const token = getEnv().DATA_ROOM_BLOB_READ_WRITE_TOKEN;
  return token ? { access: "private", token } : null;
}

function requirePrivateStore(): DriveBlobStore {
  const store = privateDriveStore();
  if (!store) throw serviceUnavailable("Data rooms are not set up here");
  return store;
}

/** Owner and in-store path of a Drive pathname or prefix, or null for any other. */
export function driveOwnerOf(pathname: string): {
  sourceScope: FileSourceScope;
  ownerId: string;
  /** Everything after `drive/<kind>/<ownerId>/`. */
  path: string;
} | null {
  const [root, kind, ownerId, ...rest] = pathname.split("/");
  const sourceScope = kind ? SCOPE_SEGMENTS[kind] : undefined;
  if (root !== "drive" || !sourceScope || !ownerId) return null;
  return { sourceScope, ownerId, path: rest.join("/") };
}

/**
 * Rooms are read on almost every Drive call, so one owner's list is kept for a
 * few seconds. Changing a room calls {@link forgetDriveRooms} on this instance;
 * another instance catches up within the TTL, and the read fallback covers the
 * gap.
 */
const ROOM_CACHE_TTL_MS = 5_000;
const roomCache = new Map<string, { at: number; rooms: DriveRoomRef[] }>();

export function forgetDriveRooms(): void {
  roomCache.clear();
}

export async function driveRoomsOf(
  sourceScope: FileSourceScope,
  ownerId: string,
): Promise<DriveRoomRef[]> {
  const key = `${sourceScope}:${ownerId}`;
  const cached = roomCache.get(key);
  if (cached && Date.now() - cached.at < ROOM_CACHE_TTL_MS) return cached.rooms;
  const rooms = await prisma.dataRoom.findMany({
    where: { sourceScope, ownerId },
    select: { folderPath: true, storage: true },
  });
  roomCache.set(key, { at: Date.now(), rooms });
  return rooms;
}

/** The room a path inside the store belongs to, if any. */
export function roomContaining(
  rooms: readonly DriveRoomRef[],
  path: string,
): DriveRoomRef | undefined {
  return rooms.find(
    (room) =>
      path === room.folderPath || path.startsWith(`${room.folderPath}/`),
  );
}

interface RoutedStores {
  write: DriveBlobStore;
  /** Where to look, in order. */
  read: DriveBlobStore[];
}

async function routeOf(pathname: string): Promise<RoutedStores> {
  const owner = driveOwnerOf(pathname);
  const publicStore = publicDriveStore();
  // Without the private store there is nothing to route to.
  const privateStore = privateDriveStore();
  if (!owner || !privateStore)
    return { write: publicStore, read: [publicStore] };
  const rooms = await driveRoomsOf(owner.sourceScope, owner.ownerId);
  if (rooms.length === 0) return { write: publicStore, read: [publicStore] };
  const room = roomContaining(rooms, owner.path);
  if (room && room.storage !== DataRoomStorage.MOVING_OUT)
    return { write: privateStore, read: [privateStore, publicStore] };
  return { write: publicStore, read: [publicStore, privateStore] };
}

/** True when a path is inside a data room. */
export async function isInDataRoom(pathname: string): Promise<boolean> {
  const owner = driveOwnerOf(pathname);
  if (!owner) return false;
  const rooms = await driveRoomsOf(owner.sourceScope, owner.ownerId);
  return roomContaining(rooms, owner.path) !== undefined;
}

/** The store new bytes at this pathname go to. */
export async function driveWriteStore(
  pathname: string,
): Promise<DriveBlobStore> {
  return (await routeOf(pathname)).write;
}

export interface DriveHeadResult extends HeadBlobResult {
  access: BlobAccessType;
}

/** Metadata of a Drive object, from whichever store holds it, or null. */
export async function driveHead(
  pathname: string,
  options: { abortSignal?: AbortSignal } = {},
): Promise<DriveHeadResult | null> {
  for (const store of (await routeOf(pathname)).read) {
    try {
      const meta = await head(pathname, {
        token: store.token,
        abortSignal: options.abortSignal,
      });
      return { ...meta, access: store.access };
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
  }
  return null;
}

/**
 * The public URL of a Drive object, for the places that hand one to the
 * outside world (a social post, an ad, a newsletter, a Task file). Null when
 * the object is in a data room: its files never leave Sokosumi that way.
 */
export async function publicDriveUrl(pathname: string): Promise<string | null> {
  if (await isInDataRoom(pathname)) return null;
  const meta = await driveHead(pathname);
  if (!meta) throw new BlobNotFoundError();
  return meta.access === "public" ? meta.url : null;
}

/** How long a signed address for a private object works. */
const SIGNED_READ_VALID_MS = 10 * 60 * 1000;

/**
 * An address a server-side reader can fetch the object from: the plain URL of
 * a public object, a short-lived signed one for a data room's private object.
 * Never for a browser of someone outside: a signed address works for anyone
 * holding it until it expires.
 */
export async function driveReadUrl(
  pathname: string,
  validMs = SIGNED_READ_VALID_MS,
): Promise<string> {
  const meta = await driveHead(pathname);
  if (!meta) throw new BlobNotFoundError();
  if (meta.access === "public") return meta.url;
  const store = requirePrivateStore();
  const validUntil = Date.now() + validMs;
  const signedToken = await issueSignedToken({
    token: store.token,
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}

export async function driveExists(pathname: string): Promise<boolean> {
  return (await driveHead(pathname)) !== null;
}

export interface DriveReadResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
  access: BlobAccessType;
  /** Set when a `range` was asked for and honoured. */
  contentRange: string | null;
}

/** The bytes of a Drive object, or null when no store has it. */
export async function driveRead(
  pathname: string,
  options: { range?: string; abortSignal?: AbortSignal } = {},
): Promise<DriveReadResult | null> {
  for (const store of (await routeOf(pathname)).read) {
    const result = await get(pathname, {
      access: store.access,
      token: store.token,
      abortSignal: options.abortSignal,
      ...(options.range ? { headers: { range: options.range } } : {}),
    }).catch((error: unknown) => {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    });
    if (!result || result.statusCode !== 200) continue;
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      size: result.blob.size,
      access: store.access,
      contentRange: result.headers.get("content-range"),
    };
  }
  return null;
}

export type DrivePutOptions = Omit<PutCommandOptions, "access" | "token">;

/** Writes bytes to the store the pathname belongs in. */
export async function drivePut(
  pathname: string,
  body: Parameters<typeof put>[1],
  options: DrivePutOptions = {},
): Promise<PutBlobResult & { access: BlobAccessType }> {
  const store = await driveWriteStore(pathname);
  const result = await put(pathname, body, {
    ...options,
    access: store.access,
    token: store.token,
  });
  return { ...result, access: store.access };
}

/** Deletes Drive objects from every store that might hold them. */
export async function driveDel(pathnames: readonly string[]): Promise<void> {
  if (pathnames.length === 0) return;
  const byToken = new Map<string, string[]>();
  for (const pathname of pathnames) {
    for (const store of (await routeOf(pathname)).read) {
      const batch = byToken.get(store.token) ?? [];
      batch.push(pathname);
      byToken.set(store.token, batch);
    }
  }
  for (const [token, batch] of byToken) await del(batch, { token });
}

/**
 * Moves one object to a new pathname, across stores when the two sides belong
 * in different ones (into or out of a data room). Returns the new metadata.
 */
export async function driveRename(
  fromPathname: string,
  toPathname: string,
  options: { contentType?: string; cacheControlMaxAge?: number } = {},
): Promise<{ url: string; pathname: string; access: BlobAccessType }> {
  const source = await driveHead(fromPathname);
  if (!source) throw new BlobNotFoundError();
  const target = await driveWriteStore(toPathname);
  const contentType = options.contentType ?? source.contentType;
  if (source.access === target.access) {
    const result = await rename(fromPathname, toPathname, {
      token: target.token,
      access: target.access,
      addRandomSuffix: false,
      contentType,
      cacheControlMaxAge: options.cacheControlMaxAge,
    });
    return {
      url: result.url,
      pathname: result.pathname,
      access: target.access,
    };
  }
  return transferBetweenStores({
    fromPathname,
    fromStore: storeFor(source.access),
    toPathname,
    toStore: target,
    contentType,
    cacheControlMaxAge: options.cacheControlMaxAge,
  });
}

function storeFor(access: BlobAccessType): DriveBlobStore {
  return access === "private" ? requirePrivateStore() : publicDriveStore();
}

/** Streams an object from one store to the other, then removes the source. */
export async function transferBetweenStores(input: {
  fromPathname: string;
  fromStore: DriveBlobStore;
  toPathname: string;
  toStore: DriveBlobStore;
  /** Defaults to the source object's own type. */
  contentType?: string;
  cacheControlMaxAge?: number;
}): Promise<{ url: string; pathname: string; access: BlobAccessType }> {
  const source = await get(input.fromPathname, {
    access: input.fromStore.access,
    token: input.fromStore.token,
  });
  if (!source || source.statusCode !== 200) throw new BlobNotFoundError();
  const result = await put(input.toPathname, source.stream, {
    access: input.toStore.access,
    token: input.toStore.token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: input.contentType ?? source.blob.contentType,
    cacheControlMaxAge: input.cacheControlMaxAge,
  });
  await del(input.fromPathname, { token: input.fromStore.token });
  return {
    url: result.url,
    pathname: result.pathname,
    access: input.toStore.access,
  };
}

/** The most blobs one merged listing reads before it stops. */
const MERGED_LISTING_CAP = 20_000;
const MERGE_CURSOR_PREFIX = "dr:";
const CHAIN_PRIVATE_PREFIX = "drp:";

/**
 * Lists a Drive prefix across stores, in the shape `list` returns.
 *
 * Three cases, cheapest first:
 * - the owner has no room under or around the prefix: the public store alone;
 * - the prefix is inside a private room: the private store alone;
 * - otherwise both. When every room involved has finished moving, the stores
 *   are paged one after the other (public, then private) and never hold the
 *   same object. While one is still moving, both are read in full and merged,
 *   because the same pathname can briefly sit in each.
 */
export async function driveList(options: {
  prefix: string;
  cursor?: string;
  limit?: number;
  mode?: "expanded" | "folded";
}): Promise<DriveListResult> {
  const publicStore = publicDriveStore();
  const owner = driveOwnerOf(options.prefix);
  const privateStore = privateDriveStore();
  if (!owner || !privateStore) return listStore(publicStore, options);
  const rooms = await driveRoomsOf(owner.sourceScope, owner.ownerId);
  const relevant = rooms.filter(
    (room) =>
      `${room.folderPath}/`.startsWith(owner.path) ||
      owner.path.startsWith(`${room.folderPath}/`),
  );
  if (relevant.length === 0) return listStore(publicStore, options);

  const moving = relevant.some(
    (room) => room.storage !== DataRoomStorage.PRIVATE,
  );
  const inside = roomContaining(relevant, owner.path.replace(/\/$/, ""));
  if (inside && !moving) return listStore(privateStore, options);
  if (moving) return listMerged([privateStore, publicStore], options);
  return listChained(publicStore, privateStore, options);
}

async function listStore(
  store: DriveBlobStore,
  options: {
    prefix: string;
    cursor?: string;
    limit?: number;
    mode?: "expanded" | "folded";
  },
): Promise<DriveListResult> {
  const page = await list({
    prefix: options.prefix,
    cursor: options.cursor,
    limit: options.limit,
    mode: options.mode,
    token: store.token,
  });
  return {
    blobs: page.blobs.map((blob) => ({ ...blob, access: store.access })),
    folders: "folders" in page ? page.folders : [],
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
}

async function listChained(
  publicStore: DriveBlobStore,
  privateStore: DriveBlobStore,
  options: {
    prefix: string;
    cursor?: string;
    limit?: number;
    mode?: "expanded" | "folded";
  },
): Promise<DriveListResult> {
  const onPrivate = options.cursor?.startsWith(CHAIN_PRIVATE_PREFIX) ?? false;
  if (onPrivate) {
    const rest =
      options.cursor?.slice(CHAIN_PRIVATE_PREFIX.length) || undefined;
    const page = await listStore(privateStore, { ...options, cursor: rest });
    return {
      ...page,
      cursor: page.hasMore
        ? `${CHAIN_PRIVATE_PREFIX}${page.cursor}`
        : undefined,
    };
  }
  const page = await listStore(publicStore, options);
  if (page.hasMore) return page;
  // The rest of this page comes from the private store, so a room's folder
  // shows up even where the public store has nothing left to list.
  const next = await listStore(privateStore, {
    ...options,
    cursor: undefined,
    limit: Math.max((options.limit ?? 1_000) - page.blobs.length, 1),
  });
  return {
    blobs: [...page.blobs, ...next.blobs],
    folders: [...new Set([...page.folders, ...next.folders])].sort(),
    cursor: next.hasMore ? `${CHAIN_PRIVATE_PREFIX}${next.cursor}` : undefined,
    hasMore: next.hasMore,
  };
}

async function listMerged(
  stores: DriveBlobStore[],
  options: {
    prefix: string;
    cursor?: string;
    limit?: number;
    mode?: "expanded" | "folded";
  },
): Promise<DriveListResult> {
  const blobs = new Map<string, DriveListedBlob>();
  const folders = new Set<string>();
  for (const store of stores) {
    let cursor: string | undefined;
    do {
      const page = await listStore(store, {
        prefix: options.prefix,
        mode: options.mode,
        cursor,
        limit: 1_000,
      });
      for (const blob of page.blobs)
        if (!blobs.has(blob.pathname)) blobs.set(blob.pathname, blob);
      for (const folder of page.folders) folders.add(folder);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && blobs.size < MERGED_LISTING_CAP);
  }
  const sorted = [...blobs.values()].sort((a, b) =>
    a.pathname.localeCompare(b.pathname),
  );
  const offset = options.cursor?.startsWith(MERGE_CURSOR_PREFIX)
    ? Number(options.cursor.slice(MERGE_CURSOR_PREFIX.length)) || 0
    : 0;
  const limit = options.limit ?? 1_000;
  const pageBlobs = sorted.slice(offset, offset + limit);
  const hasMore = offset + limit < sorted.length;
  return {
    blobs: pageBlobs,
    // Folders come whole on the first page, as they would from one store.
    folders: offset === 0 ? [...folders].sort() : [],
    cursor: hasMore ? `${MERGE_CURSOR_PREFIX}${offset + limit}` : undefined,
    hasMore,
  };
}

/** True when any object sits under a prefix, in either store. */
export async function driveHasAny(prefix: string): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await driveList({ prefix, cursor, limit: 1 });
    if (page.blobs.length > 0) return true;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return false;
}
