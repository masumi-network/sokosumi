import { createHash } from "node:crypto";

import { FileResourceLifecycle, type Prisma } from "@sokosumi/database";
import {
  clampDriveFileName,
  FILE_UPLOAD_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import JSZip from "jszip";

import prisma from "@/lib/db/prisma";
import { driveExists, driveHasAny } from "@/lib/drive-blob";
import {
  ownerDrivePathname,
  writeOwnerDriveFile,
} from "@/services/image-studio-drive.service";

export const GOOGLE_SHEET_REFRESH_MS = 60 * 60 * 1000;
const EXPORT_TIMEOUT_MS = 30_000;
const DUE_BATCH = 25;
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Why a sheet could not be read: shown to the people whose file it is. */
export type GoogleSheetError = "not_shared" | "too_large" | "failed";

export class GoogleSheetExportError extends Error {
  constructor(readonly reason: GoogleSheetError) {
    super(`Google Sheet export failed: ${reason}`);
  }
}

export interface GoogleSheetLink {
  resourceId: string;
  pathname: string;
  name: string;
  url: string;
  syncedAt: Date;
  error: GoogleSheetError | null;
}

/** The spreadsheet a Google Sheets address points at, or null. */
export function googleSpreadsheetId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com")
    return null;
  return (
    /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(
      url.pathname,
    )?.[1] ?? null
  );
}

export function googleSheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

function exportedName(disposition: string | null): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain name.
    }
  }
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? "Google Sheet.xlsx";
}

/**
 * Hashes the workbook's parts rather than its bytes: Google zips every export
 * with fresh timestamps, so the bytes differ even when nothing changed.
 */
async function workbookHash(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const hash = createHash("sha256");
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (entry.dir || name.startsWith("docProps/")) continue;
    hash.update(name);
    hash.update(await entry.async("uint8array"));
  }
  return hash.digest("hex");
}

/** The sheet as an .xlsx, which Google serves only when the link is shared. */
export async function exportGoogleSheet(spreadsheetId: string): Promise<{
  name: string;
  bytes: Buffer;
  contentHash: string;
}> {
  const response = await fetch(
    `${googleSheetUrl(spreadsheetId)}/export?format=xlsx`,
    { signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) },
  ).catch(() => {
    throw new GoogleSheetExportError("failed");
  });
  // A sheet that is not shared answers with a sign-in page, not a 403.
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith(XLSX_TYPE)
  ) {
    await response.body?.cancel();
    throw new GoogleSheetExportError(
      response.status >= 500 ? "failed" : "not_shared",
    );
  }
  if (
    Number(response.headers.get("content-length")) > FILE_UPLOAD_MAX_SIZE_BYTES
  ) {
    await response.body?.cancel();
    throw new GoogleSheetExportError("too_large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > FILE_UPLOAD_MAX_SIZE_BYTES)
    throw new GoogleSheetExportError("too_large");
  const name = exportedName(response.headers.get("content-disposition"));
  return {
    name: name.toLowerCase().endsWith(".xlsx") ? name : `${name}.xlsx`,
    bytes,
    contentHash: await workbookHash(bytes),
  };
}

export class GoogleSheetNameTakenError extends Error {}

/** Copies the sheet into a Drive folder and keeps it refreshed. */
export async function linkGoogleSheet(input: {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  folder: string;
  spreadsheetId: string;
}): Promise<GoogleSheetLink> {
  const sheet = await exportGoogleSheet(input.spreadsheetId);
  const name = clampDriveFileName(sheet.name);
  const pathname = ownerDrivePathname({ ...input, name });
  if ((await driveExists(pathname)) || (await driveHasAny(`${pathname}/`)))
    throw new GoogleSheetNameTakenError(name);

  const file = await writeOwnerDriveFile({
    ...input,
    pathname,
    name,
    bytes: sheet.bytes,
    contentType: XLSX_TYPE,
  });
  if (!file) throw new GoogleSheetExportError("failed");

  const syncedAt = new Date();
  await prisma.driveGoogleSheet.upsert({
    where: { resourceId: file.id },
    create: {
      resourceId: file.id,
      spreadsheetId: input.spreadsheetId,
      contentHash: sheet.contentHash,
      syncedAt,
    },
    update: {
      spreadsheetId: input.spreadsheetId,
      contentHash: sheet.contentHash,
      syncedAt,
      lastError: null,
    },
  });
  return {
    resourceId: file.id,
    pathname,
    name,
    url: googleSheetUrl(input.spreadsheetId),
    syncedAt,
    error: null,
  };
}

const linkSelect = {
  id: true,
  resourceId: true,
  spreadsheetId: true,
  contentHash: true,
  syncedAt: true,
  lastError: true,
  resource: {
    select: {
      workspaceId: true,
      sourceId: true,
      displayName: true,
      ownerUserId: true,
      ownerOrganizationId: true,
      lifecycle: true,
    },
  },
} satisfies Prisma.DriveGoogleSheetSelect;

type LinkRow = Prisma.DriveGoogleSheetGetPayload<{ select: typeof linkSelect }>;

function toLink(row: LinkRow): GoogleSheetLink {
  return {
    resourceId: row.resourceId,
    pathname: row.resource.sourceId,
    name: row.resource.displayName,
    url: googleSheetUrl(row.spreadsheetId),
    syncedAt: row.syncedAt,
    error: (row.lastError as GoogleSheetError | null) ?? null,
  };
}

function findLink(resourceId: string) {
  return prisma.driveGoogleSheet.findFirst({
    where: {
      resourceId,
      resource: { lifecycle: FileResourceLifecycle.ACTIVE },
    },
    select: linkSelect,
  });
}

/** The Google Sheet a Drive file copies, or null when it is a plain file. */
export async function findGoogleSheetLink(
  resourceId: string,
): Promise<GoogleSheetLink | null> {
  const row = await findLink(resourceId);
  return row ? toLink(row) : null;
}

/**
 * Reads the sheet again and rewrites the file when it changed. A failure is
 * kept on the link, and the copy stays as it was.
 */
async function refresh(row: LinkRow): Promise<GoogleSheetLink> {
  const { resource } = row;
  const ownerUserId = resource.ownerUserId ?? "";
  let contentHash = row.contentHash;
  let lastError: GoogleSheetError | null = null;
  try {
    const sheet = await exportGoogleSheet(row.spreadsheetId);
    if (sheet.contentHash !== row.contentHash) {
      // Deleted or moved while Google answered: writing would bring it back.
      const current = await prisma.fileResource.findFirst({
        where: {
          googleSheet: { id: row.id },
          sourceId: resource.sourceId,
          lifecycle: FileResourceLifecycle.ACTIVE,
        },
        select: { id: true },
      });
      if (!current) return toLink(row);
      const file = await writeOwnerDriveFile({
        workspaceId: resource.workspaceId,
        organizationId: resource.ownerOrganizationId,
        userId: ownerUserId,
        pathname: resource.sourceId,
        name: resource.displayName,
        bytes: sheet.bytes,
        contentType: XLSX_TYPE,
      });
      if (!file) throw new GoogleSheetExportError("failed");
      contentHash = sheet.contentHash;
    }
  } catch (error) {
    lastError =
      error instanceof GoogleSheetExportError ? error.reason : "failed";
    console.warn("[drive-google-sheet] Refresh failed", {
      id: row.id,
      reason: lastError,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  const updated = await prisma.driveGoogleSheet.update({
    where: { id: row.id },
    data: { contentHash, syncedAt: new Date(), lastError },
    select: linkSelect,
  });
  return toLink(updated);
}

/** Refreshes one linked file now; null when the file is not a linked sheet. */
export async function refreshGoogleSheetLink(
  resourceId: string,
): Promise<GoogleSheetLink | null> {
  const row = await findLink(resourceId);
  return row ? refresh(row) : null;
}

/** Refreshes the sheets not read for an hour, oldest first. */
export async function refreshDueGoogleSheets(options: {
  shouldContinue: () => boolean;
}): Promise<{ refreshed: number; failed: number }> {
  const due = await prisma.driveGoogleSheet.findMany({
    where: {
      syncedAt: { lt: new Date(Date.now() - GOOGLE_SHEET_REFRESH_MS) },
      resource: { lifecycle: FileResourceLifecycle.ACTIVE },
    },
    orderBy: { syncedAt: "asc" },
    take: DUE_BATCH,
    select: linkSelect,
  });
  let refreshed = 0;
  let failed = 0;
  for (const row of due) {
    if (!options.shouldContinue()) break;
    const link = await refresh(row);
    if (link.error) failed += 1;
    else refreshed += 1;
  }
  return { refreshed, failed };
}
