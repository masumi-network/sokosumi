import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  driveGoogleSheet: { findFirst: vi.fn(), update: vi.fn() },
  fileResource: { findFirst: vi.fn() },
}));
const writeOwnerDriveFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/drive-blob", () => ({
  driveExists: vi.fn(),
  driveHasAny: vi.fn(),
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  ownerDrivePathname: vi.fn(),
  writeOwnerDriveFile,
}));

import {
  exportGoogleSheet,
  googleSpreadsheetId,
  refreshGoogleSheetLink,
} from "./drive-google-sheet.service";

const SHEET_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function workbook(cell: string, modified: string): Promise<Uint8Array> {
  const zip = new JSZip();
  const date = new Date(modified);
  zip.file("xl/worksheets/sheet1.xml", `<worksheet>${cell}</worksheet>`, {
    date,
  });
  zip.file("docProps/core.xml", `<modified>${modified}</modified>`, { date });
  return zip.generateAsync({ type: "uint8array" });
}

function respondWith(body: Uint8Array | string, headers: HeadersInit) {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(body as BodyInit, { status: 200, headers }),
  );
}

function sheetResponse(bytes: Uint8Array) {
  respondWith(bytes, {
    "content-type": XLSX_TYPE,
    "content-disposition": `attachment; filename="Model.xlsx"; filename*=UTF-8''Q4%20Model.xlsx`,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("googleSpreadsheetId", () => {
  it("reads the id from the addresses Google Sheets hands out", () => {
    for (const address of [
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`,
      ` https://docs.google.com/spreadsheets/d/${SHEET_ID} `,
    ])
      expect(googleSpreadsheetId(address)).toBe(SHEET_ID);
  });

  it("refuses anything that is not a Google Sheets link", () => {
    for (const address of [
      `https://docs.google.com/document/d/${SHEET_ID}/edit`,
      `https://evil.example/spreadsheets/d/${SHEET_ID}`,
      `http://docs.google.com/spreadsheets/d/${SHEET_ID}`,
      "https://docs.google.com/spreadsheets/d/e/2PACX/pubhtml",
      "not a link",
    ])
      expect(googleSpreadsheetId(address)).toBeNull();
  });
});

describe("exportGoogleSheet", () => {
  it("names the copy after the sheet and hashes what it holds", async () => {
    sheetResponse(await workbook("<v>1</v>", "2026-11-12T10:00:00Z"));
    const first = await exportGoogleSheet(SHEET_ID);
    sheetResponse(await workbook("<v>1</v>", "2026-11-12T11:00:00Z"));
    const again = await exportGoogleSheet(SHEET_ID);
    sheetResponse(await workbook("<v>2</v>", "2026-11-12T11:00:00Z"));
    const changed = await exportGoogleSheet(SHEET_ID);

    expect(fetch).toHaveBeenCalledWith(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`,
      expect.anything(),
    );
    expect(first.name).toBe("Q4 Model.xlsx");
    expect(again.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it("says the sheet is not shared when Google answers with a sign-in page", async () => {
    respondWith("<html>Sign in</html>", { "content-type": "text/html" });
    await expect(exportGoogleSheet(SHEET_ID)).rejects.toMatchObject({
      reason: "not_shared",
    });
  });

  it("refuses a sheet larger than an upload may be", async () => {
    respondWith("", {
      "content-type": XLSX_TYPE,
      "content-length": String(10 * 1024 * 1024 * 1024),
    });
    await expect(exportGoogleSheet(SHEET_ID)).rejects.toMatchObject({
      reason: "too_large",
    });
  });
});

describe("refreshGoogleSheetLink", () => {
  const resource = {
    workspaceId: "ws",
    sourceId: "drive/organizations/org/Finance/Model.xlsx",
    displayName: "Model.xlsx",
    ownerUserId: null,
    ownerOrganizationId: "org",
    lifecycle: "ACTIVE",
  };

  async function linkedTo(cell: string) {
    sheetResponse(await workbook(cell, "2026-11-12T10:00:00Z"));
    const { contentHash } = await exportGoogleSheet(SHEET_ID);
    const row = {
      id: "link",
      spreadsheetId: SHEET_ID,
      contentHash,
      syncedAt: new Date("2026-11-12T09:00:00Z"),
      lastError: null,
      resource,
    };
    prismaMock.driveGoogleSheet.findFirst.mockResolvedValue(row);
    prismaMock.driveGoogleSheet.update.mockImplementation(({ data }) => ({
      ...row,
      ...data,
    }));
    prismaMock.fileResource.findFirst.mockResolvedValue({ id: "file" });
    writeOwnerDriveFile.mockResolvedValue({ id: "file" });
  }

  it("leaves the copy alone when the sheet has not changed", async () => {
    await linkedTo("<v>1</v>");
    sheetResponse(await workbook("<v>1</v>", "2026-11-12T12:00:00Z"));

    const link = await refreshGoogleSheetLink("file");

    expect(writeOwnerDriveFile).not.toHaveBeenCalled();
    expect(link?.error).toBeNull();
  });

  it("rewrites the copy in place when the sheet changed", async () => {
    await linkedTo("<v>1</v>");
    sheetResponse(await workbook("<v>2</v>", "2026-11-12T12:00:00Z"));

    await refreshGoogleSheetLink("file");

    expect(writeOwnerDriveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org",
        pathname: resource.sourceId,
        name: "Model.xlsx",
      }),
    );
  });

  it("keeps the copy and records why when the sheet is no longer shared", async () => {
    await linkedTo("<v>1</v>");
    respondWith("<html>Sign in</html>", { "content-type": "text/html" });

    const link = await refreshGoogleSheetLink("file");

    expect(writeOwnerDriveFile).not.toHaveBeenCalled();
    expect(link?.error).toBe("not_shared");
  });

  it("does not bring back a file deleted while Google answered", async () => {
    await linkedTo("<v>1</v>");
    prismaMock.fileResource.findFirst.mockResolvedValue(null);
    sheetResponse(await workbook("<v>2</v>", "2026-11-12T12:00:00Z"));

    await refreshGoogleSheetLink("file");

    expect(writeOwnerDriveFile).not.toHaveBeenCalled();
  });
});
