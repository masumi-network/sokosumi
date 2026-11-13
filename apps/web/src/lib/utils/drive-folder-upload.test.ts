import { FILE_UPLOAD_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";
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
  const name = fullPath.split("/").at(-1)!;
  const entry = {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: vi.fn((resolve: (f: File) => void) =>
      resolve(new File(["x"], name, { type: "text/plain" })),
    ),
  };
  return entry;
}

function dirEntry(fullPath: string, children: unknown[]) {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split("/").at(-1)!,
    fullPath,
    createReader: vi.fn(() => {
      // Two batches, then empty, like Chrome past 100 entries.
      const batches = [children.slice(0, 1), children.slice(1), []];
      return {
        readEntries: (resolve: (e: unknown[]) => void) =>
          resolve(batches.shift() ?? []),
      };
    }),
  };
}

function drop(...entries: unknown[]): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
    })),
    files: [],
  } as unknown as DataTransfer;
}

describe("driveDropEntries", () => {
  it("reads dropped folders recursively, keeping their paths", async () => {
    const tree = dirEntry("/Launch", [
      fileEntry("/Launch/brief.txt"),
      dirEntry("/Launch/assets", [fileEntry("/Launch/assets/notes.txt")]),
    ]);

    const { entries, overflow } = await driveDropEntries(
      drop(tree, fileEntry("/todo.txt")),
    );

    expect(entries.map((e) => [e.path, e.file.name])).toEqual([
      ["Launch/brief.txt", "brief.txt"],
      ["Launch/assets/notes.txt", "notes.txt"],
      ["todo.txt", "todo.txt"],
    ]);
    expect(overflow).toBe(0);
  });

  it("never opens hidden folders or reads hidden files", async () => {
    const git = dirEntry("/Launch/.git", [fileEntry("/Launch/.git/config")]);
    const dsStore = fileEntry("/Launch/.DS_Store");

    const { entries } = await driveDropEntries(
      drop(dirEntry("/Launch", [git, dsStore, fileEntry("/Launch/brief.txt")])),
    );

    expect(entries.map((e) => e.path)).toEqual(["Launch/brief.txt"]);
    expect(git.createReader).not.toHaveBeenCalled();
    expect(dsStore.file).not.toHaveBeenCalled();
  });

  it("stops reading at the cap but counts every file past it", async () => {
    const files = Array.from(
      { length: DRIVE_FOLDER_UPLOAD_MAX_FILES + 3 },
      (_, i) => fileEntry(`/Big/${i}.txt`),
    );

    const { entries, overflow } = await driveDropEntries(
      drop(dirEntry("/Big", files)),
    );

    expect(entries).toHaveLength(DRIVE_FOLDER_UPLOAD_MAX_FILES);
    expect(overflow).toBe(3);
    expect(files.at(-1)?.file).not.toHaveBeenCalled();
  });
});
