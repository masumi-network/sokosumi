import { FILE_UPLOAD_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  DRIVE_FOLDER_UPLOAD_MAX_FILES,
  driveDropEntries,
  planDriveFolderUpload,
} from "./drive-folder-upload";

function picked(path: string, type = "text/plain", size = 3) {
  const name = path.split("/").at(-1) ?? path;
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return { file, path };
}

describe("planDriveFolderUpload", () => {
  it("keeps the folder tree under the current folder", () => {
    const plan = planDriveFolderUpload(
      [
        picked("Launch/brief.txt"),
        picked("Launch/assets/logo.png", "image/png"),
      ],
      "Clients",
    );

    expect(plan.rootFolder).toBe("Clients/Launch");
    expect(plan.uploads.map((u) => [u.file.name, u.folder])).toEqual([
      ["brief.txt", "Clients/Launch"],
      ["logo.png", "Clients/Launch/assets"],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("puts loose files in the open folder and opens no folder", () => {
    const plan = planDriveFolderUpload(
      [picked("a.txt"), picked("b.txt")],
      "Clients",
    );
    expect(plan.rootFolder).toBe("");
    expect(plan.uploads.map((u) => u.folder)).toEqual(["Clients", "Clients"]);
  });

  it("opens no folder when several folders come at once", () => {
    const plan = planDriveFolderUpload(
      [picked("One/a.txt"), picked("Two/b.txt")],
      "",
    );
    expect(plan.rootFolder).toBe("");
    expect(plan.uploads.map((u) => u.folder)).toEqual(["One", "Two"]);
  });

  it("starts at the root when no folder is open", () => {
    const plan = planDriveFolderUpload([picked("Launch/a.txt")], "");
    expect(plan.rootFolder).toBe("Launch");
    expect(plan.uploads[0]?.folder).toBe("Launch");
  });

  it("drops hidden files silently and reports refused ones", () => {
    const plan = planDriveFolderUpload(
      [
        picked("Launch/.DS_Store", ""),
        picked("Launch/.git/config", ""),
        picked("Launch/run.exe", "application/x-msdownload"),
        picked(
          "Launch/big.pdf",
          "application/pdf",
          FILE_UPLOAD_MAX_SIZE_BYTES + 1,
        ),
        picked("Launch/ok.pdf", "application/pdf"),
      ],
      "",
    );

    expect(plan.uploads.map((u) => u.file.name)).toEqual(["ok.pdf"]);
    expect(plan.skipped).toEqual([
      { path: "Launch/run.exe", reason: "type" },
      { path: "Launch/big.pdf", reason: "size" },
    ]);
  });

  it("caps the number of files and reports the rest", () => {
    const files = Array.from(
      { length: DRIVE_FOLDER_UPLOAD_MAX_FILES + 2 },
      (_, i) => picked(`Launch/${i}.txt`),
    );
    const plan = planDriveFolderUpload(files, "");

    expect(plan.uploads).toHaveLength(DRIVE_FOLDER_UPLOAD_MAX_FILES);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["limit", "limit"]);
  });
});

/** Just enough of the File and Directory Entries API for a drop. */
function fileEntry(fullPath: string) {
  const file = new File(["x"], fullPath.split("/").at(-1)!, {
    type: "text/plain",
  });
  return {
    isFile: true,
    isDirectory: false,
    fullPath,
    file: (resolve: (f: File) => void) => resolve(file),
  };
}

function dirEntry(fullPath: string, children: unknown[]) {
  return {
    isFile: false,
    isDirectory: true,
    fullPath,
    createReader: () => {
      // Two batches, then empty, like Chrome past 100 entries.
      const batches = [children.slice(0, 1), children.slice(1), []];
      return {
        readEntries: (resolve: (e: unknown[]) => void) =>
          resolve(batches.shift() ?? []),
      };
    },
  };
}

describe("driveDropEntries", () => {
  it("reads dropped folders recursively, keeping their paths", async () => {
    const tree = dirEntry("/Launch", [
      fileEntry("/Launch/brief.txt"),
      dirEntry("/Launch/assets", [fileEntry("/Launch/assets/notes.txt")]),
    ]);
    const loose = fileEntry("/todo.txt");
    const dataTransfer = {
      items: [tree, loose].map((entry) => ({
        kind: "file",
        webkitGetAsEntry: () => entry,
      })),
      files: [],
    } as unknown as DataTransfer;

    const entries = await driveDropEntries(dataTransfer);

    expect(entries.map((e) => [e.path, e.file.name])).toEqual([
      ["Launch/brief.txt", "brief.txt"],
      ["Launch/assets/notes.txt", "notes.txt"],
      ["todo.txt", "todo.txt"],
    ]);
  });
});
