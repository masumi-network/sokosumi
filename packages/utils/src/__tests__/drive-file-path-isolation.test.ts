import { describe, expect, it } from "vitest";

import {
  buildOrganizationDriveFilePathname,
  buildUserDriveFilePathname,
} from "../drive-file-path.js";
import { buildOrganizationLogoPathname } from "../organization-logo-path.js";
import { buildTaskFilePathname } from "../task-file-upload.js";
import { buildUserUploadPathname } from "../user-upload-path.js";

/**
 * Isolation tests: ensure Drive file paths stay under `drive/users/` and
 * `drive/organizations/` and never collide with tasks/, images/, chats/,
 * jobs/, users/{id}/... (non-drive user uploads), or
 * organizations/{id}/logos/.
 */
describe("drive file path isolation", () => {
  it("user drive files never land under tasks/", () => {
    const drivePath = buildUserDriveFilePathname(
      "user_123",
      "file_abc",
      "file.pdf",
    );
    const taskPath = buildTaskFilePathname("tsk_123", "file.pdf");

    expect(drivePath).toMatch(/^drive\/users\//);
    expect(taskPath).toMatch(/^tasks\//);
    expect(drivePath).not.toMatch(/^tasks\//);
    expect(taskPath).not.toMatch(/^drive\//);
  });

  it("user drive files never land under users/{id}/ (non-drive user uploads)", () => {
    const drivePath = buildUserDriveFilePathname(
      "user_123",
      "file_abc",
      "file.pdf",
    );
    const userUploadPath = buildUserUploadPathname("user_123", "file.pdf");

    expect(drivePath).toMatch(/^drive\/users\/user_123\//);
    expect(userUploadPath).toMatch(/^users\/user_123\//);
    expect(userUploadPath).not.toMatch(/^drive\//);
  });

  it("org drive files never land under organizations/{id}/logos/", () => {
    const drivePath = buildOrganizationDriveFilePathname(
      "org_123",
      "file_def",
      "file.pdf",
    );
    const logoPath = buildOrganizationLogoPathname("org_123", "logo.png");

    expect(drivePath).toMatch(/^drive\/organizations\/org_123\//);
    expect(logoPath).toMatch(/^organizations\/org_123\/logos\//);
    expect(drivePath).not.toMatch(/\/logos\//);
    expect(logoPath).not.toMatch(/^drive\//);
  });

  it("drive files never land under reserved prefixes", () => {
    const userDrivePath = buildUserDriveFilePathname(
      "user_123",
      "file_abc",
      "file.pdf",
    );
    const orgDrivePath = buildOrganizationDriveFilePathname(
      "org_123",
      "file_def",
      "file.pdf",
    );

    const reservedPrefixes = [
      "tasks/",
      "images/",
      "chats/",
      "jobs/",
      "users/", // non-drive user uploads
      "organizations/", // logos, not drive
    ];

    for (const prefix of reservedPrefixes) {
      expect(userDrivePath).not.toMatch(new RegExp(`^${prefix}`));
      expect(orgDrivePath).not.toMatch(new RegExp(`^${prefix}`));
    }

    expect(userDrivePath).toMatch(/^drive\/users\//);
    expect(orgDrivePath).toMatch(/^drive\/organizations\//);
  });

  it("user and org drive files are isolated from each other", () => {
    const userDrivePath = buildUserDriveFilePathname(
      "user_123",
      "file_abc",
      "file.pdf",
    );
    const orgDrivePath = buildOrganizationDriveFilePathname(
      "org_123",
      "file_def",
      "file.pdf",
    );

    expect(userDrivePath).toMatch(/^drive\/users\//);
    expect(orgDrivePath).toMatch(/^drive\/organizations\//);
    expect(userDrivePath).not.toMatch(/\/organizations\//);
    expect(orgDrivePath).not.toMatch(/\/users\//);
  });
});
