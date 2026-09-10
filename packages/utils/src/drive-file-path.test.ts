import { describe, expect, it } from "vitest";

import {
  buildOrganizationDriveFilePathname,
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePathname,
  buildUserDriveFilePrefix,
  clampDriveFileName,
  DRIVE_FILE_MAX_NAME_LENGTH,
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
});
