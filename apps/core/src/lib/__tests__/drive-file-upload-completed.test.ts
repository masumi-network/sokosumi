import {
  buildOrganizationDriveFilePathname,
  buildUserDriveFilePathname,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

describe("drive file upload completed pathname matching", () => {
  it("webhook pathname matches mint for user files with spaces", () => {
    const userId = "user_123";
    const fileId = "file_abc";
    const filename = "hello world.txt";

    // Mint builds the pathname like this
    const mintPathname = buildUserDriveFilePathname(userId, fileId, filename);

    // Webhook should build the same pathname (spaces → underscores)
    expect(mintPathname).toBe("drive/users/user_123/file_abc/hello_world.txt");
    expect(mintPathname).not.toContain(" ");
  });

  it("webhook pathname matches mint for org files with spaces", () => {
    const orgId = "org_456";
    const fileId = "file_def";
    const filename = "my document.pdf";

    // Mint builds the pathname like this
    const mintPathname = buildOrganizationDriveFilePathname(
      orgId,
      fileId,
      filename,
    );

    // Webhook should build the same pathname (spaces → underscores)
    expect(mintPathname).toBe(
      "drive/organizations/org_456/file_def/my_document.pdf",
    );
    expect(mintPathname).not.toContain(" ");
  });

  it("webhook pathname matches mint for filenames with special chars", () => {
    const userId = "user_123";
    const fileId = "file_xyz";
    const filename = "../../../etc/passwd";

    // Mint sanitizes path traversal
    const mintPathname = buildUserDriveFilePathname(userId, fileId, filename);

    expect(mintPathname).toBe("drive/users/user_123/file_xyz/etc_passwd");
    expect(mintPathname).not.toContain("..");
    expect(mintPathname).not.toContain("/etc/");
  });

  it("webhook pathname matches mint for filenames with leading dots", () => {
    const userId = "user_123";
    const fileId = "file_ghi";
    const filename = ".hidden";

    const mintPathname = buildUserDriveFilePathname(userId, fileId, filename);

    // Leading dots are trimmed by sanitization
    expect(mintPathname).toBe("drive/users/user_123/file_ghi/hidden");
    expect(mintPathname).not.toMatch(/\/\./);
  });

  it("webhook pathname matches mint for empty fallback", () => {
    const userId = "user_123";
    const fileId = "file_jkl";
    const filename = "___"; // All underscores → "file" fallback

    const mintPathname = buildUserDriveFilePathname(userId, fileId, filename);

    expect(mintPathname).toBe("drive/users/user_123/file_jkl/file");
  });
});
