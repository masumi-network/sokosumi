import { describe, expect, it } from "vitest";

import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";

const ME = "user_me";

describe("parseDriveFilePathname", () => {
  it("reads a personal file as the caller's", () => {
    expect(
      parseDriveFilePathname(`drive/users/${ME}/a b/100%.pdf`, ME),
    ).toEqual({ scope: "user", ownerId: ME });
  });

  it("reads an organization file as that organization's", () => {
    expect(
      parseDriveFilePathname("drive/organizations/org_1/Room/f.pdf", ME),
    ).toEqual({ scope: "organization", ownerId: "org_1" });
  });

  // Blob reads rebuild the pathname as a URL, which resolves these to another
  // owner's file while the checks above still see the caller's own prefix.
  it.each([
    `drive/users/${ME}/../user_victim/secret.pdf`,
    `drive/users/${ME}/../../organizations/org_2/f.pdf`,
    "drive/organizations/org_1/./Room/f.pdf",
    "drive/organizations/org_1/../org_2/f.pdf",
    `drive/users/${ME}/%2e%2e/user_victim/f.pdf`,
    `drive/users/${ME}/.%2E/user_victim/f.pdf`,
    `drive/users/${ME}/..\\user_victim/f.pdf`,
    `drive/users/${ME}/.\t./user_victim/f.pdf`,
    `drive/users/${ME}//f.pdf`,
  ])("refuses %j", (pathname) => {
    expect(() => parseDriveFilePathname(pathname, ME)).toThrow(
      "Invalid pathname format",
    );
  });
});
