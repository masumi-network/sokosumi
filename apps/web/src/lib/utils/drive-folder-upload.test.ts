import { FILE_UPLOAD_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  DRIVE_FOLDER_UPLOAD_MAX_FILES,
  planDriveFolderUpload,
} from "./drive-folder-upload";

function picked(path: string, type = "text/plain", size = 3): File {
  const name = path.split("/").at(-1) ?? path;
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  Object.defineProperty(file, "size", { value: size });
  return file;
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
