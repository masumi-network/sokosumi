import { describe, expect, it } from "vitest";

import {
  compareDriveFileTypeFamily,
  driveFileTypeFamily,
} from "@/helpers/drive-file-type-family";

describe("driveFileTypeFamily", () => {
  it("maps common extensions to stable families", () => {
    expect(driveFileTypeFamily("photo.PNG")).toBe("image");
    expect(driveFileTypeFamily("clip.mp4")).toBe("video");
    expect(driveFileTypeFamily("song.mp3")).toBe("audio");
    expect(driveFileTypeFamily("brief.pdf")).toBe("pdf");
    expect(driveFileTypeFamily("notes.docx")).toBe("document");
    expect(driveFileTypeFamily("sheet.xlsx")).toBe("spreadsheet");
    expect(driveFileTypeFamily("deck.pptx")).toBe("presentation");
    expect(driveFileTypeFamily("bundle.zip")).toBe("archive");
    expect(driveFileTypeFamily("app.ts")).toBe("code");
    expect(driveFileTypeFamily("readme.md")).toBe("text");
    expect(driveFileTypeFamily("mystery.bin")).toBe("other");
  });

  it("prefers mime type when provided", () => {
    expect(driveFileTypeFamily("file.bin", "image/png")).toBe("image");
    expect(driveFileTypeFamily("file.bin", "application/pdf")).toBe("pdf");
    expect(
      driveFileTypeFamily(
        "file.bin",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("spreadsheet");
  });

  it("falls back to extension when mime is unknown", () => {
    expect(driveFileTypeFamily("report.pdf", "application/octet-stream")).toBe(
      "pdf",
    );
  });
});

describe("compareDriveFileTypeFamily", () => {
  it("orders families by documented rank then treats same family as equal", () => {
    // image before pdf in DRIVE_FILE_TYPE_FAMILIES
    expect(compareDriveFileTypeFamily("a.pdf", "b.png")).toBeGreaterThan(0);
    expect(compareDriveFileTypeFamily("a.png", "b.jpg")).toBe(0);
  });
});
