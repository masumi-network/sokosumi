import { describe, expect, it } from "vitest";

import {
  buildOrganizationDriveFolderMarkerPathname,
  buildUserDriveFolderMarkerPathname,
  DRIVE_FOLDER_MARKER_BASENAME,
  isDriveFolderMarker,
  isDriveFolderMarkerName,
  normalizeDriveFolderPath,
} from "../drive-file-path.js";

describe("Drive folder marker utilities", () => {
  describe("DRIVE_FOLDER_MARKER_BASENAME", () => {
    it("has reserved marker basename", () => {
      expect(DRIVE_FOLDER_MARKER_BASENAME).toBe("__drive_folder__");
    });
  });

  describe("normalizeDriveFolderPath", () => {
    it("removes leading and trailing slashes", () => {
      expect(normalizeDriveFolderPath("/folder/")).toBe("folder");
      expect(normalizeDriveFolderPath("//folder//")).toBe("folder");
    });

    it("collapses multiple slashes", () => {
      expect(normalizeDriveFolderPath("folder1//folder2")).toBe(
        "folder1/folder2",
      );
    });

    it("returns empty string for empty or slash-only paths", () => {
      expect(normalizeDriveFolderPath("")).toBe("");
      expect(normalizeDriveFolderPath("/")).toBe("");
      expect(normalizeDriveFolderPath("//")).toBe("");
    });

    it("preserves nested folder structure", () => {
      expect(normalizeDriveFolderPath("Projects/2026/Reports")).toBe(
        "Projects/2026/Reports",
      );
    });
  });

  describe("buildUserDriveFolderMarkerPathname", () => {
    it("builds marker pathname for user folder", () => {
      expect(buildUserDriveFolderMarkerPathname("user_123", "Projects")).toBe(
        "drive/users/user_123/Projects/__drive_folder__",
      );
    });

    it("builds marker pathname for nested user folder", () => {
      expect(
        buildUserDriveFolderMarkerPathname("user_123", "Projects/2026"),
      ).toBe("drive/users/user_123/Projects/2026/__drive_folder__");
    });

    it("handles empty folder path (root marker)", () => {
      expect(buildUserDriveFolderMarkerPathname("user_123", "")).toBe(
        "drive/users/user_123/__drive_folder__",
      );
    });
  });

  describe("buildOrganizationDriveFolderMarkerPathname", () => {
    it("builds marker pathname for organization folder", () => {
      expect(
        buildOrganizationDriveFolderMarkerPathname("org_123", "Shared"),
      ).toBe("drive/organizations/org_123/Shared/__drive_folder__");
    });

    it("builds marker pathname for nested organization folder", () => {
      expect(
        buildOrganizationDriveFolderMarkerPathname("org_123", "Shared/Docs"),
      ).toBe("drive/organizations/org_123/Shared/Docs/__drive_folder__");
    });
  });

  describe("isDriveFolderMarker", () => {
    it("detects folder marker pathname", () => {
      expect(
        isDriveFolderMarker("drive/users/user_123/Projects/__drive_folder__"),
      ).toBe(true);
      expect(
        isDriveFolderMarker(
          "drive/organizations/org_123/Shared/__drive_folder__",
        ),
      ).toBe(true);
    });

    it("rejects non-marker pathnames", () => {
      expect(isDriveFolderMarker("drive/users/user_123/file.pdf")).toBe(false);
      expect(isDriveFolderMarker("drive/users/user_123/Projects/doc.txt")).toBe(
        false,
      );
    });

    it("rejects marker name not at end of path", () => {
      expect(
        isDriveFolderMarker("drive/users/user_123/__drive_folder__/file.pdf"),
      ).toBe(false);
    });
  });

  describe("isDriveFolderMarkerName", () => {
    it("detects reserved marker basename", () => {
      expect(isDriveFolderMarkerName("__drive_folder__")).toBe(true);
    });

    it("rejects normal file names", () => {
      expect(isDriveFolderMarkerName("file.pdf")).toBe(false);
      expect(isDriveFolderMarkerName("document.txt")).toBe(false);
    });

    it("rejects partial matches", () => {
      expect(isDriveFolderMarkerName("__drive_folder__extra")).toBe(false);
      expect(isDriveFolderMarkerName("prefix__drive_folder__")).toBe(false);
    });
  });
});
