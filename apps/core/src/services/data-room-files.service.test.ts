import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  buildDataRoomTree,
  type DataRoomFile,
  viewableInRoom,
} from "./data-room-files.service";

function file(
  path: string,
  updatedAt = "2026-11-01T00:00:00.000Z",
): DataRoomFile {
  return {
    resourceId: `r:${path}`,
    path,
    name: path.split("/").at(-1) ?? path,
    sizeBytes: 1,
    mimeType: "application/pdf",
    updatedAt: new Date(updatedAt),
  };
}

const files = [
  file("Teaser.pdf"),
  file("Legal/Articles.pdf"),
  file("Legal/NDA.pdf", "2026-11-08T00:00:00.000Z"),
  file("Finance/Model.xlsx"),
  file("Finance/2025/Audit.pdf"),
];

describe("buildDataRoomTree", () => {
  it("puts folders first, sorts by name and numbers every row", () => {
    const rows = buildDataRoomTree({ files, order: new Map() });
    expect(rows.map((row) => `${row.number} ${row.path}`)).toEqual([
      "1 Finance",
      "1.1 Finance/2025",
      "1.1.1 Finance/2025/Audit.pdf",
      "1.2 Finance/Model.xlsx",
      "2 Legal",
      "2.1 Legal/Articles.pdf",
      "2.2 Legal/NDA.pdf",
      "3 Teaser.pdf",
    ]);
    expect(rows.find((row) => row.path === "Finance/2025")?.depth).toBe(1);
  });

  it("follows the owner's order where they set one", () => {
    const rows = buildDataRoomTree({
      files,
      order: new Map([
        ["Legal", 1],
        ["Legal/NDA.pdf", 1],
      ]),
    });
    expect(rows.slice(0, 3).map((row) => `${row.number} ${row.path}`)).toEqual([
      "1 Legal",
      "1.1 Legal/NDA.pdf",
      "1.2 Legal/Articles.pdf",
    ]);
  });

  it("shows a person only the folders they were given", () => {
    const rows = buildDataRoomTree({
      files,
      order: new Map(),
      member: { folderPaths: ["Legal"], previousVisitAt: null },
    });
    expect(rows.map((row) => row.path)).toEqual([
      "Legal",
      "Legal/Articles.pdf",
      "Legal/NDA.pdf",
    ]);
  });

  it("marks what changed since the previous visit, and the folders holding it", () => {
    const rows = buildDataRoomTree({
      files,
      order: new Map(),
      member: {
        folderPaths: [],
        previousVisitAt: new Date("2026-11-05T00:00:00.000Z"),
      },
    });
    expect(rows.filter((row) => row.isNew).map((row) => row.path)).toEqual([
      "Legal",
      "Legal/NDA.pdf",
    ]);
  });

  it("marks nothing new on a first visit", () => {
    const rows = buildDataRoomTree({
      files,
      order: new Map(),
      member: { folderPaths: [], previousVisitAt: null },
    });
    expect(rows.some((row) => row.isNew)).toBe(false);
  });
});

describe("viewableInRoom", () => {
  it("lets a viewer open a spreadsheet even when downloads are off", () => {
    expect(
      viewableInRoom({
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        name: "Model.xlsx",
      }),
    ).toBe(true);
    expect(viewableInRoom({ mimeType: null, name: "Model.XLSX" })).toBe(true);
    expect(
      viewableInRoom({ mimeType: "text/csv", name: "Cap table.csv" }),
    ).toBe(true);
  });

  it("still keeps other office files download-only", () => {
    expect(
      viewableInRoom({
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        name: "Memo.docx",
      }),
    ).toBe(false);
    expect(
      viewableInRoom({ mimeType: "application/vnd.ms-excel", name: "Old.xls" }),
    ).toBe(false);
  });
});
