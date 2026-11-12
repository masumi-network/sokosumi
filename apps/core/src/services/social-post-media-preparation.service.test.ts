import type { SocialPostMediaRef } from "@sokosumi/utils";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DriveFileDownloadError } from "@/helpers/drive-file-download";

import {
  prepareSocialPostMedia,
  requirePreparedSocialPostProvider,
} from "./social-post-media-preparation.service";

const { downloadMock, writeMock } = vi.hoisted(() => ({
  downloadMock: vi.fn(),
  writeMock: vi.fn(),
}));
vi.mock("@/helpers/drive-file-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/drive-file-download")>()),
  downloadDriveFile: downloadMock,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  writeStudioDriveFile: writeMock,
}));

const scope = {
  workspaceId: "workspace",
  organizationId: null,
  userId: "user",
};
const source: SocialPostMediaRef = {
  pathname: "drive/users/user/image.jpg",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user/image.jpg",
  name: "image.jpg",
  size: 100,
  mimeType: "image/jpeg",
  kind: "image",
};

async function image(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
) {
  return sharp({
    create: { width, height, channels: 3, background: "#d4d4d4" },
  })
    .toFormat(format)
    .toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
  writeMock.mockImplementation(async ({ name, bytes, contentType }) => ({
    name,
    size: bytes.byteLength,
    mimeType: contentType,
    pathname: `drive/users/user/Content Studio/${name}`,
    url: `https://store.public.blob.vercel-storage.com/drive/users/user/Content%20Studio/${name}`,
  }));
});

describe("prepareSocialPostMedia", () => {
  it("keeps the user's X image reference and never uploads another image", async () => {
    expect(await prepareSocialPostMedia(scope, "x", [source])).toEqual([
      source,
    ]);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("keeps an allowed Instagram JPEG reference without a notice or replacement file", async () => {
    downloadMock.mockResolvedValue({
      bytes: await image(1280, 720),
      mimeType: "image/jpeg",
    });
    expect(await prepareSocialPostMedia(scope, "instagram", [source])).toEqual([
      source,
    ]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("stores the adapted bytes and original ref together with the notice", async () => {
    const bytes = await image(720, 1280, "png");
    downloadMock.mockResolvedValue({ bytes, mimeType: "image/png" });
    const original = {
      ...source,
      mimeType: "image/png",
      size: bytes.byteLength,
    };
    const [prepared] = await prepareSocialPostMedia(scope, "instagram", [
      original,
    ]);
    expect(prepared.transformation).toEqual({
      provider: "instagram",
      code: "pad_4_5",
      notice: "Instagram will pad this image to 4:5.",
      original,
    });
    expect(prepared.mimeType).toBe("image/jpeg");
    expect(
      await sharp(writeMock.mock.calls[0][0].bytes).metadata(),
    ).toMatchObject({ width: 1024, height: 1280 });
  });

  it("restores the source when switching a prepared Instagram post to X", async () => {
    const prepared: SocialPostMediaRef = {
      ...source,
      pathname: "drive/users/user/adapted.jpg",
      fileUrl:
        "https://store.public.blob.vercel-storage.com/drive/users/user/adapted.jpg",
      transformation: {
        provider: "instagram",
        code: "pad_4_5",
        notice: "untrusted",
        original: source,
      },
    };
    expect(await prepareSocialPostMedia(scope, "x", [prepared])).toEqual([
      source,
    ]);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("checks the original's workspace before downloading or trusting its notice", async () => {
    const prepared = {
      ...source,
      transformation: {
        provider: "instagram" as const,
        code: "pad_4_5" as const,
        notice: "untrusted",
        original: {
          ...source,
          pathname: "drive/organizations/someone-else/image.jpg",
          fileUrl:
            "https://store.public.blob.vercel-storage.com/drive/organizations/someone-else/image.jpg",
        },
      },
    };
    await expect(
      prepareSocialPostMedia(scope, "instagram", [prepared]),
    ).rejects.toMatchObject({ status: 403 });
    expect(downloadMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("rejects an account race before storing media for a different network", async () => {
    const media = await prepareSocialPostMedia(scope, "x", [source]);
    expect(() => requirePreparedSocialPostProvider(media, "instagram")).toThrow(
      "The social account changed",
    );
  });

  it("refuses a failed derivative save instead of publishing the unadapted source", async () => {
    downloadMock.mockResolvedValue({
      bytes: await image(720, 1280),
      mimeType: "image/jpeg",
    });
    writeMock.mockResolvedValue(null);
    await expect(
      prepareSocialPostMedia(scope, "instagram", [source]),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("keeps the original bytes when Instagram scales the image itself", async () => {
    const bytes = await image(2880, 1620);
    downloadMock.mockResolvedValue({ bytes, mimeType: "image/jpeg" });
    const [prepared] = await prepareSocialPostMedia(scope, "instagram", [
      source,
    ]);
    expect(prepared.pathname).toBe(source.pathname);
    expect(prepared.transformation).toMatchObject({
      code: "resize",
      notice: "Instagram will resize this image.",
      original: source,
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "too_large", "wrong_type"] as const)(
    "returns an actionable client error when an image is %s",
    async (reason) => {
      downloadMock.mockRejectedValue(new DriveFileDownloadError(reason));
      await expect(
        prepareSocialPostMedia(scope, "instagram", [source]),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("choose another image and try again"),
      });
      expect(writeMock).not.toHaveBeenCalled();
    },
  );
});
