import { SsrfError } from "@sokosumi/net";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  downloadSocialPostMedia,
  requireSocialPostMedia,
  SocialPostMediaError,
} from "@/helpers/social-post-media";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

const IMAGE_REF = {
  pathname: "drive/users/user_1/launch.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/launch.png",
  name: "launch.png",
  size: 3,
  mimeType: "image/png",
  kind: "image" as const,
};

const CLIP_REF = {
  pathname: "drive/users/user_1/clip.mp4",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
  name: "clip.mp4",
  size: 3,
  mimeType: "video/mp4",
  kind: "video" as const,
};

function mediaResponse(
  body: Uint8Array<ArrayBuffer>,
  contentType: string | null,
  status = 200,
): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return new Response(status === 204 ? null : body, { status, headers });
}

describe("downloadSocialPostMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads bytes with the provider's byte cap and normalized mime type", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      mediaResponse(new Uint8Array([1, 2, 3]), "image/png; charset=binary"),
    );

    await expect(downloadSocialPostMedia("x", [IMAGE_REF])).resolves.toEqual([
      {
        bytes: new Uint8Array([1, 2, 3]),
        name: "launch.png",
        mimeType: "image/png",
        kind: "image",
      },
    ]);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      IMAGE_REF.fileUrl,
      expect.objectContaining({ maxResponseBytes: 5 * 1024 * 1024 }),
    );
  });

  it("uses the provider's own byte cap", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      mediaResponse(new Uint8Array([1]), "image/jpeg"),
    );

    await downloadSocialPostMedia("instagram", [
      { ...IMAGE_REF, name: "photo.jpg", mimeType: "image/jpeg" },
    ]);

    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      IMAGE_REF.fileUrl,
      expect.objectContaining({ maxResponseBytes: 8 * 1024 * 1024 }),
    );
  });

  it("fails permanently when a Drive file is gone", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      mediaResponse(new Uint8Array(), null, 404),
    );

    await expect(
      downloadSocialPostMedia("x", [IMAGE_REF]),
    ).rejects.toMatchObject({
      name: "SocialPostMediaError",
      kind: "media_missing",
      message: 'Media file "launch.png" is no longer available',
    });
  });

  it("fails permanently when the served content type does not match the kind", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      mediaResponse(new Uint8Array([1]), "text/html"),
    );

    await expect(
      downloadSocialPostMedia("x", [CLIP_REF]),
    ).rejects.toMatchObject({
      kind: "media_type_mismatch",
      message: 'Media file "clip.mp4" is not a video',
    });
  });

  it("fails permanently when the download exceeds the cap", async () => {
    ssrfSafeFetchMock.mockRejectedValue(
      new SsrfError("Response body exceeds maxResponseBytes (5242880)"),
    );

    await expect(
      downloadSocialPostMedia("x", [IMAGE_REF]),
    ).rejects.toMatchObject({
      kind: "media_too_large",
      message: 'Media file "launch.png" is too large for X',
    });
  });

  it("fails permanently when the bytes exceed the cap despite the response headers", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      mediaResponse(new Uint8Array(5 * 1024 * 1024 + 1), "image/png"),
    );

    await expect(
      downloadSocialPostMedia("x", [IMAGE_REF]),
    ).rejects.toMatchObject({ kind: "media_too_large" });
  });

  it("rethrows transient transport failures", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("socket hang up"));

    await expect(downloadSocialPostMedia("x", [IMAGE_REF])).rejects.toThrow(
      "socket hang up",
    );
  });
});

describe("requireSocialPostMedia", () => {
  it("fails permanently when the stored media cannot be read", () => {
    expect(() => requireSocialPostMedia([{ pathname: 1 }], "post_1")).toThrow(
      SocialPostMediaError,
    );
  });
});
