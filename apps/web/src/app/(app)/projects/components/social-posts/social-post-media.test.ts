import { describe, expect, it } from "vitest";
import {
  buildSocialPostMediaRef,
  hasSocialPostMedia,
  sameSocialPostMedia,
  socialPostMediaRefFromDriveFile,
} from "@/app/projects/components/social-posts/social-post-media";
import type { DriveFile } from "@/lib/clients/generated/core/types.gen";

const driveFile: DriveFile = {
  name: "launch.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/launch.png",
  pathname: "drive/users/user_1/launch.png",
  size: 2048,
  uploadedAt: new Date("2026-09-14T10:00:00.000Z"),
};

describe("buildSocialPostMediaRef", () => {
  it.each([
    ["photo.jpg", "image/jpeg", "image"],
    ["photo.png", "image/png", "image"],
    ["photo.webp", "image/webp", "image"],
    ["loop.gif", "image/gif", "gif"],
    ["clip.mp4", "video/mp4", "video"],
    ["clip.MOV", "video/quicktime", "video"],
  ])("maps %s to %s (%s)", (name, mimeType, kind) => {
    expect(
      buildSocialPostMediaRef({
        name,
        size: 10,
        pathname: `drive/users/user_1/${name}`,
        fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/${name}`,
      }),
    ).toMatchObject({ mimeType, kind });
  });

  it.each(["notes.pdf", "vector.svg", "no-extension", ".png"])(
    "rejects %s",
    (name) => {
      expect(
        buildSocialPostMediaRef({
          name,
          size: 10,
          pathname: `drive/users/user_1/${name}`,
          fileUrl: "https://store.public.blob.vercel-storage.com/x",
        }),
      ).toBeNull();
    },
  );

  it("keeps the Drive identity of a picked file", () => {
    expect(socialPostMediaRefFromDriveFile(driveFile)).toEqual({
      pathname: driveFile.pathname,
      fileUrl: driveFile.fileUrl,
      name: driveFile.name,
      size: driveFile.size,
      mimeType: "image/png",
      kind: "image",
    });
  });
});

describe("sameSocialPostMedia", () => {
  const ref = (pathname: string) => ({
    pathname,
    fileUrl: `https://store.public.blob.vercel-storage.com/${pathname}`,
    name: pathname.split("/").pop() ?? pathname,
    size: 1,
    mimeType: "image/png",
    kind: "image" as const,
  });

  it("ignores attachment order", () => {
    expect(
      sameSocialPostMedia([ref("a"), ref("b")], [ref("b"), ref("a")]),
    ).toBe(true);
  });

  it("detects a different file", () => {
    expect(sameSocialPostMedia([ref("a")], [ref("b")])).toBe(false);
  });

  it("detects a different count", () => {
    expect(sameSocialPostMedia([ref("a"), ref("a")], [ref("a")])).toBe(false);
  });

  it("detects duplicated pathnames", () => {
    expect(
      sameSocialPostMedia([ref("a"), ref("a")], [ref("a"), ref("b")]),
    ).toBe(false);
  });

  it("finds an attached pathname", () => {
    expect(hasSocialPostMedia([ref("a")], "a")).toBe(true);
    expect(hasSocialPostMedia([ref("a")], "b")).toBe(false);
  });
});
