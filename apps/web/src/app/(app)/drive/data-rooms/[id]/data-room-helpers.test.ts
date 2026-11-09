import type { DataRoomTreeRow } from "@sokosumi/core-client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/data-room.client", () => ({}));

import { moveRow, orderEntries } from "./data-room-contents";
import { parseEmails } from "./data-room-people";

function row(path: string, kind: "folder" | "file"): DataRoomTreeRow {
  return {
    kind,
    path,
    name: path.split("/").at(-1) ?? path,
    depth: path.split("/").length - 1,
    number: "",
    resourceId: kind === "file" ? `r:${path}` : null,
    sizeBytes: null,
    mimeType: null,
    updatedAt: null,
    isNew: false,
  };
}

const rows = [
  row("Finance", "folder"),
  row("Finance/Model.xlsx", "file"),
  row("Legal", "folder"),
  row("Legal/NDA.pdf", "file"),
  row("Teaser.pdf", "file"),
];

describe("parseEmails", () => {
  it("takes addresses pasted with commas, semicolons, spaces or new lines, once each", () => {
    expect(
      parseEmails("Anna@Fund.com, ben@fund.com;\ncarl@fund.com  anna@fund.com"),
    ).toEqual(["anna@fund.com", "ben@fund.com", "carl@fund.com"]);
  });
});

describe("moveRow", () => {
  it("moves a folder with everything in it", () => {
    expect(moveRow(rows, "Legal", -1).map((r) => r.path)).toEqual([
      "Legal",
      "Legal/NDA.pdf",
      "Finance",
      "Finance/Model.xlsx",
      "Teaser.pdf",
    ]);
  });

  it("never moves a file above a folder, nor past the end", () => {
    expect(moveRow(rows, "Teaser.pdf", -1)).toEqual(rows);
    expect(moveRow(rows, "Legal", 1)).toEqual(rows);
  });
});

describe("orderEntries", () => {
  it("counts positions from 1 within each folder", () => {
    expect(orderEntries(rows)).toEqual([
      { path: "Finance", position: 1 },
      { path: "Finance/Model.xlsx", position: 1 },
      { path: "Legal", position: 2 },
      { path: "Legal/NDA.pdf", position: 1 },
      { path: "Teaser.pdf", position: 3 },
    ]);
  });
});
