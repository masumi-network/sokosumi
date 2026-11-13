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
const PDF_TYPE = "application/pdf";

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
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? "";
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

/**
 * One export of the sheet. Google serves it only when the link is shared; a
 * sheet that is not answers with a sign-in page, not a 403.
 */
async function fetchExport(
  spreadsheetId: string,
  query: string,
  type: string,
): Promise<Response> {
  const response = await fetch(
    `${googleSheetUrl(spreadsheetId)}/export?${query}`,
    { signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) },
  ).catch(() => {
    throw new GoogleSheetExportError("failed");
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith(type)) {
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
  return response;
}

async function exportBytes(response: Response): Promise<Buffer> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > FILE_UPLOAD_MAX_SIZE_BYTES)
    throw new GoogleSheetExportError("too_large");
  return bytes;
}

/**
 * The sheet's title and a hash of what it holds, read from the .xlsx export:
 * Google's PDF is stamped with the time it was made, so only the workbook
 * shows whether anything changed.
 */
export async function readGoogleSheet(
  spreadsheetId: string,
): Promise<{ title: string; contentHash: string }> {
  const response = await fetchExport(spreadsheetId, "format=xlsx", XLSX_TYPE);
  const title = exportedName(response.headers.get("content-disposition"))
    .replace(/\.xlsx$/i, "")
    .trim();
  return {
    title: title || "Google Sheet",
    contentHash: await workbookHash(await exportBytes(response)),
  };
}

/** Google's own render of every tab, charts included, laid out for reading. */
const PDF_LAYOUT = new URLSearchParams({
  format: "pdf",
  size: "A4",
  portrait: "false",
  fitw: "true",
  gridlines: "false",
  printtitle: "false",
  sheetnames: "false",
  pagenum: "UNDEFINED",
  top_margin: "0.4",
  bottom_margin: "0.4",
  left_margin: "0.4",
  right_margin: "0.4",
}).toString();

export async function renderGoogleSheet(
  spreadsheetId: string,
): Promise<Buffer> {
  return exportBytes(await fetchExport(spreadsheetId, PDF_LAYOUT, PDF_TYPE));
}

export class GoogleSheetNameTakenError extends Error {}

/** Saves Google's PDF of the sheet into a Drive folder and keeps it current. */
export async function linkGoogleSheet(input: {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  folder: string;
  spreadsheetId: string;
}): Promise<GoogleSheetLink> {
  const sheet = await readGoogleSheet(input.spreadsheetId);
  const name = clampDriveFileName(`${sheet.title}.pdf`);
  const pathname = ownerDrivePathname({ ...input, name });
  if ((await driveExists(pathname)) || (await driveHasAny(`${pathname}/`)))
    throw new GoogleSheetNameTakenError(name);

  const file = await writeOwnerDriveFile({
    ...input,
    pathname,
    name,
    bytes: await renderGoogleSheet(input.spreadsheetId),
    contentType: PDF_TYPE,
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
    const sheet = await readGoogleSheet(row.spreadsheetId);
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
        bytes: await renderGoogleSheet(row.spreadsheetId),
        contentType: PDF_TYPE,
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
