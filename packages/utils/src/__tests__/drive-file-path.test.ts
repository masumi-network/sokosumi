import { describe, expect, it } from "vitest";

import {
  buildOrganizationDriveFilePathname,
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePathname,
  buildUserDriveFilePrefix,
  clampDriveFileName,
  DRIVE_FILE_MAX_NAME_LENGTH,
  isOwnedOrganizationDriveFileUrl,
  isOwnedUserDriveFileUrl,
  sanitizeDriveFileName,
} from "../drive-file-path.js";

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

    it("detects owned user drive file URLs", () => {
      expect(
        isOwnedUserDriveFileUrl(
          "https://blob.example.com/drive/users/user_123/hello_world.txt",
          "user_123",
        ),
      ).toBe(true);

      expect(
        isOwnedUserDriveFileUrl(
          "https://blob.example.com/drive/users/user_456/hello_world.txt",
          "user_123",
        ),
      ).toBe(false);

      expect(
        isOwnedUserDriveFileUrl(
          "https://blob.example.com/tasks/tsk_123/hello_world-abc.txt",
          "user_123",
        ),
      ).toBe(false);

      expect(isOwnedUserDriveFileUrl("not-a-url", "user_123")).toBe(false);
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

    it("detects owned organization drive file URLs", () => {
      expect(
        isOwnedOrganizationDriveFileUrl(
          "https://blob.example.com/drive/organizations/org_123/hello_world.txt",
          "org_123",
        ),
      ).toBe(true);

      expect(
        isOwnedOrganizationDriveFileUrl(
          "https://blob.example.com/drive/organizations/org_456/hello_world.txt",
          "org_123",
        ),
      ).toBe(false);

      expect(
        isOwnedOrganizationDriveFileUrl(
          "https://blob.example.com/drive/users/user_123/hello_world.txt",
          "org_123",
        ),
      ).toBe(false);

      expect(isOwnedOrganizationDriveFileUrl("not-a-url", "org_123")).toBe(
        false,
      );
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
