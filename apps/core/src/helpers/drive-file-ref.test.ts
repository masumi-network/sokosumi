import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { requireWorkspaceDriveFileUrl } from "./drive-file-ref";

const USER_ID = "user_123";
const ORG_ID = "org_123";
const HOST = "https://store.public.blob.vercel-storage.com";

function ref(pathname: string, fileUrl = `${HOST}/${pathname}`) {
  return { pathname, fileUrl, name: "launch.png" };
}

describe("requireWorkspaceDriveFileUrl", () => {
  const personal = { userId: USER_ID, organizationId: null };
  const organization = { userId: USER_ID, organizationId: ORG_ID };

  it("returns the URL of a file in the personal workspace's Drive", () => {
    const pathname = `drive/users/${USER_ID}/launch.png`;
    expect(requireWorkspaceDriveFileUrl(personal, ref(pathname))).toBe(
      `${HOST}/${pathname}`,
    );
  });

  it("returns the URL of a file in the active organization's Drive", () => {
    const pathname = `drive/organizations/${ORG_ID}/launch.png`;
    expect(requireWorkspaceDriveFileUrl(organization, ref(pathname))).toBe(
      `${HOST}/${pathname}`,
    );
  });

  it("accepts a percent-encoded URL for the same pathname", () => {
    const pathname = `drive/users/${USER_ID}/my launch.png`;
    expect(
      requireWorkspaceDriveFileUrl(
        personal,
        ref(pathname, `${HOST}/drive/users/${USER_ID}/my%20launch.png`),
      ),
    ).toBe(`${HOST}/drive/users/${USER_ID}/my%20launch.png`);
  });

  it.each([
    [
      "a personal file in an organization workspace",
      organization,
      `drive/users/${USER_ID}/a.png`,
    ],
    [
      "an organization file in a personal workspace",
      personal,
      `drive/organizations/${ORG_ID}/a.png`,
    ],
    [
      "another organization's file",
      organization,
      "drive/organizations/org_other/a.png",
    ],
  ])("rejects %s with 403", (_name, workspace, pathname) => {
    expect(() =>
      requireWorkspaceDriveFileUrl(workspace, ref(pathname)),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it.each([
    ["a pathname outside the Drive", "avatars/me.png"],
    ["another user's file", "drive/users/user_other/a.png"],
  ])("rejects %s with 422", (_name, pathname) => {
    expect(() => requireWorkspaceDriveFileUrl(personal, ref(pathname))).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });

  it.each([
    [
      "a foreign host",
      `https://evil.example/drive/users/${USER_ID}/launch.png`,
    ],
    [
      "plain http",
      `http://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/launch.png`,
    ],
    ["a URL of a different file", `${HOST}/drive/users/${USER_ID}/other.png`],
  ])("rejects %s with 400", (_name, fileUrl) => {
    expect(() =>
      requireWorkspaceDriveFileUrl(
        personal,
        ref(`drive/users/${USER_ID}/launch.png`, fileUrl),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        message: 'Media file "launch.png" is not a Drive file',
      }),
    );
  });

  it("rejects an unparsable URL with 400", () => {
    expect(() =>
      requireWorkspaceDriveFileUrl(
        personal,
        ref(`drive/users/${USER_ID}/launch.png`, "not a url"),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        message: 'Media file "launch.png" has an invalid URL',
      }),
    );
  });
});
