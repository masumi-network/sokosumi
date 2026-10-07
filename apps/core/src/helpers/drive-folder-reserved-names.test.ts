import { describe, expect, it } from "vitest";

import {
  assertDriveFolderPathNotReserved,
  DRIVE_VIRTUAL_TASKS_FOLDER_NAME,
  resolveMovedFolderPath,
} from "@/helpers/drive-folder-reserved-names";

describe("drive folder reserved names", () => {
  it("rejects root-level Tasks paths", () => {
    expect(() => assertDriveFolderPathNotReserved("Sokosumi Projects")).toThrow(
      /reserved/i,
    );
    expect(() =>
      assertDriveFolderPathNotReserved("Sokosumi Projects/Nested"),
    ).toThrow(/reserved/i);
  });

  it("no longer reserves the old Tasks name", () => {
    expect(() => assertDriveFolderPathNotReserved("Tasks")).not.toThrow();
  });

  it("allows Sokosumi Projects as a non-root segment", () => {
    expect(() =>
      assertDriveFolderPathNotReserved("Projects/Sokosumi Projects"),
    ).not.toThrow();
  });

  it("resolves moved folder paths at drive root", () => {
    expect(resolveMovedFolderPath("", "Sokosumi Projects")).toBe(
      DRIVE_VIRTUAL_TASKS_FOLDER_NAME,
    );
    expect(resolveMovedFolderPath("Projects", "Reports")).toBe(
      "Projects/Reports",
    );
  });
});
