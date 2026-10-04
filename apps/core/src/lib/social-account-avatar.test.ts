import { beforeEach, describe, expect, it, vi } from "vitest";

const { delMock, getEnvMock, putMock, ssrfSafeFetchMock } = vi.hoisted(() => ({
  delMock: vi.fn(),
  getEnvMock: vi.fn(),
  putMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ del: delMock, put: putMock }));
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import {
  deleteSocialAccountAvatarIfOwned,
  snapshotSocialAccountAvatar,
} from "./social-account-avatar";

const PROJECT_ID = "019fa92e-3818-707e-86ea-2db89f35cc23";
const STORED = `https://abc.public.blob.vercel-storage.com/social-avatars/${PROJECT_ID}/image-x-123-r.jpg`;
const params = {
  projectId: PROJECT_ID,
  provider: "x",
  externalAccountId: "123",
  avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
};

function jpegResponse(): Response {
  const body = new Uint8Array(64);
  body.set([0xff, 0xd8, 0xff]);
  return new Response(body, { status: 200 });
}

describe("snapshotSocialAccountAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
    putMock.mockResolvedValue({ url: STORED });
  });

  it("stores the picture under the Project's avatar prefix", async () => {
    ssrfSafeFetchMock.mockResolvedValue(jpegResponse());

    await expect(snapshotSocialAccountAvatar(params)).resolves.toBe(STORED);
    expect(putMock).toHaveBeenCalledWith(
      `social-avatars/${PROJECT_ID}/image-x-123.jpg`,
      expect.any(ArrayBuffer),
      expect.objectContaining({ access: "public", contentType: "image/jpeg" }),
    );
  });

  it("returns null for a non-image body without uploading", async () => {
    ssrfSafeFetchMock.mockResolvedValue(new Response("<svg/>"));

    await expect(snapshotSocialAccountAvatar(params)).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("returns null when the download fails", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("blocked"));

    await expect(snapshotSocialAccountAvatar(params)).resolves.toBeNull();
  });
});

describe("deleteSocialAccountAvatarIfOwned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
  });

  it("deletes only this Project's stored avatars", async () => {
    await deleteSocialAccountAvatarIfOwned(STORED, PROJECT_ID);
    await deleteSocialAccountAvatarIfOwned(params.avatarUrl, PROJECT_ID);
    await deleteSocialAccountAvatarIfOwned(null, PROJECT_ID);

    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith(STORED, { token: "blob_token" });
  });
});
