import { describe, expect, it } from "vitest";

import {
  buildOrganizationDriveFilePathname,
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePathname,
  buildUserDriveFilePrefix,
  clampDriveFileName,
  DRIVE_FILE_MAX_NAME_LENGTH,
  DRIVE_OWNER_PREFIX_PATTERN,
  driveFolderPathFromSourceId,
  sanitizeDriveFileName,
} from "./drive-file-path.js";

describe("drive file path helpers", () => {
  describe("user drive", () => {
    it("builds the user drive prefix", () => {
      expect(buildUserDriveFilePrefix("user_123")).toBe(
        "drive/users/user_123/",
      );
    });

    it("sanitizes drive file names", () => {
      expect(sanitizeDriveFileName("hello world.txt")).toBe("hello_world.txt");
      expect(sanitizeDriveFileName("../../../etc/passwd")).toBe("etc_passwd");
      expect(sanitizeDriveFileName(".hidden")).toBe("hidden");
      expect(sanitizeDriveFileName("___")).toBe("file");
    });

    it("builds the full user drive pathname", () => {
      expect(buildUserDriveFilePathname("user_123", "hello world.txt")).toBe(
        "drive/users/user_123/hello_world.txt",
      );
    });
  });

  describe("organization drive", () => {
    it("builds the organization drive prefix", () => {
      expect(buildOrganizationDriveFilePrefix("org_123")).toBe(
        "drive/organizations/org_123/",
      );
    });

    it("builds the full organization drive pathname", () => {
      expect(
        buildOrganizationDriveFilePathname("org_123", "hello world.txt"),
      ).toBe("drive/organizations/org_123/hello_world.txt");
    });
  });

  describe("name clamping", () => {
    it("clamps long file names", () => {
      const longName = "a".repeat(300);
      const clamped = clampDriveFileName(longName);
      expect(clamped.length).toBe(DRIVE_FILE_MAX_NAME_LENGTH);
      expect(clamped).toBe("a".repeat(DRIVE_FILE_MAX_NAME_LENGTH));
    });

    it("does not modify short file names", () => {
      const shortName = "hello.txt";
      expect(clampDriveFileName(shortName)).toBe(shortName);
    });

    it("handles exactly max length file names", () => {
      const exactName = "a".repeat(DRIVE_FILE_MAX_NAME_LENGTH);
      expect(clampDriveFileName(exactName)).toBe(exactName);
    });
  });

  /**
   * The folder a file is filed in, read back out of the pathname the upload
   * stored. This is what puts a folder on a catalog row and drives the folder
   * facet, and the catalog showed no folder at all for files that were
   * nine-tenths in one.
   */
  describe("driveFolderPathFromSourceId", () => {
    it("reads a nested folder out of an organization pathname", () => {
      expect(
        driveFolderPathFromSourceId(
          "drive/organizations/org_1/marketing/token2049+launch/brief.docx",
        ),
      ).toBe("marketing/token2049+launch");
    });

    it("reads a nested folder out of a user pathname", () => {
      expect(
        driveFolderPathFromSourceId("drive/users/user_1/Reports/q3.pdf"),
      ).toBe("Reports");
    });

    it("is null at the store root, where there is no folder", () => {
      expect(
        driveFolderPathFromSourceId("drive/organizations/org_1/brief.docx"),
      ).toBeNull();
      expect(
        driveFolderPathFromSourceId("drive/users/user_1/q3.pdf"),
      ).toBeNull();
    });

    it("is null for a source that is not a blob pathname", () => {
      // A task output's source id is a task id. Reading a folder out of that
      // would be an invention about the reader's filing.
      expect(driveFolderPathFromSourceId("task_01a0e8e7")).toBeNull();
      expect(driveFolderPathFromSourceId("")).toBeNull();
      expect(
        driveFolderPathFromSourceId("drive/tables/org_1/rows.csv"),
      ).toBeNull();
    });

    it("agrees with the pattern SQL strips the same head with", () => {
      // The catalog reads the folder in TypeScript and filters on it in SQL. If
      // these two disagree, a row shows a folder the filter cannot find.
      const nested = "drive/organizations/org_1/Media/Youtube/clip.mp4";
      expect(new RegExp(DRIVE_OWNER_PREFIX_PATTERN).test(nested)).toBe(true);
      expect(nested.replace(new RegExp(DRIVE_OWNER_PREFIX_PATTERN), "")).toBe(
        "Media/Youtube/clip.mp4",
      );
      // And it refuses a source id that is not a drive pathname, which is what
      // stops a task id's first segment becoming a folder.
      expect(
        new RegExp(DRIVE_OWNER_PREFIX_PATTERN).test("drive/org_1/clip.mp4"),
      ).toBe(false);
    });

    it("round-trips what the folder builders produce", () => {
      // The one guarantee that matters: what an upload writes is what the
      // catalog reads back.
      const pathname = `${buildOrganizationDriveFilePrefix("org_1")}Media/Youtube/clip.mp4`;
      expect(driveFolderPathFromSourceId(pathname)).toBe("Media/Youtube");
    });
  });
});
