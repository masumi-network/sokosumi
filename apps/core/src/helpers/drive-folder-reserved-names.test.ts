import { describe, expect, it } from "vitest";

import {
  assertDriveFolderPathNotReserved,
  DRIVE_VIRTUAL_TASKS_FOLDER_NAME,
  resolveMovedFolderPath,
} from "@/helpers/drive-folder-reserved-names";

describe("drive folder reserved names", () => {
  it("rejects root-level Tasks paths", () => {
    expect(() => assertDriveFolderPathNotReserved("Tasks")).toThrow(
      /reserved/i,
    );
    expect(() => assertDriveFolderPathNotReserved("Tasks/Nested")).toThrow(
      /reserved/i,
    );
  });

  it("allows Tasks as a non-root segment", () => {
    expect(() =>
      assertDriveFolderPathNotReserved("Projects/Tasks"),
    ).not.toThrow();
  });

  it("resolves moved folder paths at drive root", () => {
    expect(resolveMovedFolderPath("", "Tasks")).toBe(
      DRIVE_VIRTUAL_TASKS_FOLDER_NAME,
    );
    expect(resolveMovedFolderPath("Projects", "Reports")).toBe(
      "Projects/Reports",
    );
  });
});
