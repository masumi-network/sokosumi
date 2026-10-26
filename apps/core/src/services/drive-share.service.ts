import {
  createHmac,
  randomBytes,
  type ScryptOptions,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  type DriveShare,
  DriveShareKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarker,
  normalizeDriveFolderPath,
  validateDriveFolderPath,
} from "@sokosumi/utils";
import { head, list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { badRequest, notFound, serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/** The Drive store a share belongs to, as `resolveFileRequestContext` gives it. */
export interface DriveShareStore {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
}

export type DriveShareTarget =
  | { kind: "file"; resourceId: string }
  | { kind: "folder"; folderPath: string };

/** How long an unlocked link stays unlocked in one browser. */
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
/** A folder link lists at most this many files. */
const MAX_FOLDER_ITEMS = 2_000;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_OPTIONS: ScryptOptions = { N: 16_384, r: 8, p: 1 };

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifySharePassword(
  hash: string,
  password: string,
): Promise<boolean> {
  const [scheme, salt, expected] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const key = await scryptAsync(password, Buffer.from(salt, "base64url"));
  const wanted = Buffer.from(expected, "base64url");
  return key.length === wanted.length && timingSafeEqual(key, wanted);
}

/**
 * Proof that this browser gave the link's password, valid for a while. It is
 * bound to the current password hash, so changing or removing the password
 * ends every earlier unlock.
 */
export function createUnlockProof(
  share: Pick<DriveShare, "id" | "passwordHash">,
  now = Date.now(),
): string {
  const expiresAt = now + UNLOCK_TTL_MS;
  return `${expiresAt}.${unlockSignature(share, expiresAt)}`;
}

export function isUnlocked(
  share: Pick<DriveShare, "id" | "passwordHash">,
  proof: string | undefined,
  now = Date.now(),
): boolean {
  if (!share.passwordHash) return true;
  const [expiresRaw, signature] = (proof ?? "").split(".");
  const expiresAt = Number(expiresRaw);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < now)
    return false;
  const wanted = Buffer.from(unlockSignature(share, expiresAt));
  const given = Buffer.from(signature);
  return wanted.length === given.length && timingSafeEqual(wanted, given);
}

function unlockSignature(
  share: Pick<DriveShare, "id" | "passwordHash">,
  expiresAt: number,
): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(`drive-share:${share.id}:${share.passwordHash}:${expiresAt}`)
    .digest("base64url");
}

function sourceScopeOf(scope: DriveShareStore["scope"]): FileSourceScope {
  return scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION;
}

/** A folder path a link may name: normalized, never "" (the whole store). */
export function shareFolderPath(raw: string): string {
  const folderPath = normalizeDriveFolderPath(raw);
  const invalid = validateDriveFolderPath(folderPath);
  if (invalid) throw badRequest(invalid);
  if (!folderPath) throw badRequest("Share a folder, not the whole Files");
  return folderPath;
}

function folderPrefix(
  scope: DriveShareStore["scope"],
  ownerId: string,
  folderPath: string,
): string {
  return scope === "user"
    ? buildUserDriveFolderPrefix(ownerId, folderPath)
    : buildOrganizationDriveFolderPrefix(ownerId, folderPath);
}

function targetWhere(store: DriveShareStore, target: DriveShareTarget) {
  return target.kind === "file"
    ? { resourceId: target.resourceId, workspaceId: store.workspaceId }
    : {
        workspaceId: store.workspaceId,
        sourceScope: sourceScopeOf(store.scope),
        ownerId: store.ownerId,
        folderPath: shareFolderPath(target.folderPath),
      };
}

/** An uploaded file of this store that a link may point at. */
async function requireShareableFile(
  store: DriveShareStore,
  resourceId: string,
) {
  const resource = await prisma.fileResource.findFirst({
    where: {
      id: resourceId,
      workspaceId: store.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: sourceScopeOf(store.scope),
      lifecycle: FileResourceLifecycle.ACTIVE,
      tombstonedAt: null,
      ...(store.scope === "user"
        ? { ownerUserId: store.ownerId }
        : { ownerOrganizationId: store.ownerId }),
    },
    select: { id: true },
  });
  if (!resource) throw notFound("File not found");
}

export function findDriveShare(
  store: DriveShareStore,
  target: DriveShareTarget,
) {
  return prisma.driveShare.findFirst({ where: targetWhere(store, target) });
}

/**
 * Creates the item's link, or changes its password. `password` undefined
 * keeps the current one, null removes it.
 */
export async function upsertDriveShare(input: {
  store: DriveShareStore;
  target: DriveShareTarget;
  password?: string | null;
  userId: string;
}): Promise<DriveShare> {
  const { store, target } = input;
  if (target.kind === "file")
    await requireShareableFile(store, target.resourceId);
  const passwordHash =
    input.password === undefined
      ? undefined
      : input.password === null
        ? null
        : await hashSharePassword(input.password);
  const existing = await findDriveShare(store, target);
  if (existing) {
    if (passwordHash === undefined) return existing;
    return prisma.driveShare.update({
      where: { id: existing.id },
      data: { passwordHash },
    });
  }
  return prisma.driveShare.create({
    data: {
      token: randomBytes(24).toString("base64url"),
      workspaceId: store.workspaceId,
      sourceScope: sourceScopeOf(store.scope),
      ownerId: store.ownerId,
      kind:
        target.kind === "file" ? DriveShareKind.FILE : DriveShareKind.FOLDER,
      resourceId: target.kind === "file" ? target.resourceId : null,
      folderPath:
        target.kind === "folder" ? shareFolderPath(target.folderPath) : null,
      passwordHash: passwordHash ?? null,
      createdByUserId: input.userId,
    },
  });
}

export async function deleteDriveShare(
  store: DriveShareStore,
  shareId: string,
): Promise<void> {
  const deleted = await prisma.driveShare.deleteMany({
    where: {
      id: shareId,
      workspaceId: store.workspaceId,
      sourceScope: sourceScopeOf(store.scope),
      ownerId: store.ownerId,
    },
  });
  if (deleted.count === 0) throw notFound("Share not found");
}

/**
 * Keeps folder links pointing at a folder that moved or was renamed, its
 * subfolders included.
 */
export async function rebaseDriveFolderShares(input: {
  workspaceId: string;
  scope: DriveShareStore["scope"];
  ownerId: string;
  fromFolderPath: string;
  toFolderPath: string;
}): Promise<void> {
  const from = normalizeDriveFolderPath(input.fromFolderPath);
  const to = normalizeDriveFolderPath(input.toFolderPath);
  if (!from || from === to) return;
  const shares = await prisma.driveShare.findMany({
    where: {
      workspaceId: input.workspaceId,
      sourceScope: sourceScopeOf(input.scope),
      ownerId: input.ownerId,
      kind: DriveShareKind.FOLDER,
      OR: [{ folderPath: from }, { folderPath: { startsWith: `${from}/` } }],
    },
    select: { id: true, folderPath: true },
  });
  for (const share of shares) {
    const rest = (share.folderPath ?? "").slice(from.length);
    await prisma.driveShare.update({
      where: { id: share.id },
      data: { folderPath: `${to}${rest}` },
    });
  }
}

export interface PublicDriveShareItem {
  /** Path inside the shared folder, or the file name for a file link. */
  path: string;
  size: number;
  uploadedAt: string;
}

export type PublicDriveShare =
  | { kind: "file" | "folder"; name: string; locked: true }
  | {
      kind: "file" | "folder";
      name: string;
      locked: false;
      items: PublicDriveShareItem[];
      truncated: boolean;
    };

function blobToken(): string {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) throw serviceUnavailable("Blob storage is not configured");
  return token;
}

/** The link and where its bytes live, or null when it no longer resolves. */
async function resolveShare(token: string) {
  const share = await prisma.driveShare.findUnique({
    where: { token },
    include: {
      resource: {
        select: {
          sourceId: true,
          displayName: true,
          sizeBytes: true,
          updatedAt: true,
          tombstonedAt: true,
          lifecycle: true,
        },
      },
    },
  });
  if (!share) return null;
  const scope =
    share.sourceScope === FileSourceScope.USER ? "user" : "organization";
  if (share.kind === DriveShareKind.FILE) {
    const resource = share.resource;
    if (
      !resource ||
      resource.tombstonedAt ||
      resource.lifecycle !== FileResourceLifecycle.ACTIVE
    )
      return null;
    return {
      share,
      kind: "file" as const,
      name: resource.displayName,
      pathname: resource.sourceId,
    };
  }
  const folderPath = share.folderPath ?? "";
  return {
    share,
    kind: "folder" as const,
    name: folderPath.split("/").at(-1) ?? folderPath,
    prefix: folderPrefix(scope, share.ownerId, folderPath),
  };
}

export async function readPublicDriveShare(
  token: string,
  proof: string | undefined,
): Promise<PublicDriveShare | null> {
  const resolved = await resolveShare(token);
  if (!resolved) return null;
  const { share, kind, name } = resolved;
  if (!isUnlocked(share, proof)) return { kind, name, locked: true };
  if (resolved.kind === "file") {
    const meta = await head(resolved.pathname, { token: blobToken() }).catch(
      () => null,
    );
    if (!meta) return null;
    return {
      kind,
      name,
      locked: false,
      truncated: false,
      items: [
        {
          path: name,
          size: meta.size,
          uploadedAt: meta.uploadedAt.toISOString(),
        },
      ],
    };
  }
  const items: PublicDriveShareItem[] = [];
  let cursor: string | undefined;
  let truncated = false;
  do {
    const page = await list({
      prefix: resolved.prefix,
      token: blobToken(),
      cursor,
      limit: 1_000,
    });
    for (const blob of page.blobs) {
      if (isDriveFolderMarker(blob.pathname)) continue;
      if (items.length >= MAX_FOLDER_ITEMS) {
        truncated = true;
        break;
      }
      items.push({
        path: blob.pathname.slice(resolved.prefix.length),
        size: blob.size,
        uploadedAt: blob.uploadedAt.toISOString(),
      });
    }
    cursor = page.hasMore && !truncated ? page.cursor : undefined;
  } while (cursor);
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { kind, name, locked: false, truncated, items };
}

/** Wrong passwords before a link stops taking guesses for a while. */
const MAX_FAILED_UNLOCKS = 10;
const UNLOCK_LOCKOUT_MS = 15 * 60 * 1000;

export type UnlockOutcome =
  | { kind: "unlocked"; proof: string }
  | { kind: "wrong" }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "missing" };

/** Checks a password, counting wrong ones so a link cannot be guessed at. */
export async function unlockDriveShare(
  token: string,
  password: string,
  now = Date.now(),
): Promise<UnlockOutcome> {
  const share = await prisma.driveShare.findUnique({
    where: { token },
    select: {
      id: true,
      passwordHash: true,
      failedUnlocks: true,
      unlockLockedAt: true,
    },
  });
  if (!share?.passwordHash) return { kind: "missing" };
  const lockedUntil = share.unlockLockedAt
    ? share.unlockLockedAt.getTime() + UNLOCK_LOCKOUT_MS
    : 0;
  if (lockedUntil > now)
    return {
      kind: "locked",
      retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000),
    };
  if (await verifySharePassword(share.passwordHash, password)) {
    if (share.failedUnlocks > 0 || share.unlockLockedAt)
      await prisma.driveShare.update({
        where: { id: share.id },
        data: { failedUnlocks: 0, unlockLockedAt: null },
      });
    return { kind: "unlocked", proof: createUnlockProof(share, now) };
  }
  const failedUnlocks = share.unlockLockedAt ? 1 : share.failedUnlocks + 1;
  await prisma.driveShare.update({
    where: { id: share.id },
    data:
      failedUnlocks >= MAX_FAILED_UNLOCKS
        ? { failedUnlocks: 0, unlockLockedAt: new Date(now) }
        : { failedUnlocks, unlockLockedAt: null },
  });
  return { kind: "wrong" };
}

/**
 * Where to download one file of a link: the blob URL, after the link and its
 * password check out and `path` is inside what it shares.
 */
export async function driveShareDownloadUrl(input: {
  token: string;
  proof: string | undefined;
  path?: string;
}): Promise<string | null> {
  const resolved = await resolveShare(input.token);
  if (!resolved || !isUnlocked(resolved.share, input.proof)) return null;
  let pathname: string;
  if (resolved.kind === "file") {
    pathname = resolved.pathname;
  } else {
    const path = normalizeDriveFolderPath(input.path ?? "");
    if (!path || validateDriveFolderPath(path)) return null;
    pathname = `${resolved.prefix}${path}`;
    if (isDriveFolderMarker(pathname)) return null;
  }
  const meta = await head(pathname, { token: blobToken() }).catch(() => null);
  if (!meta) return null;
  const url = new URL(meta.url);
  url.searchParams.set("download", "1");
  return url.toString();
}
