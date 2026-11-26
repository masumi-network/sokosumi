import { describe, expect, it } from "vitest";
import {
  croppedFileName,
  cropRect,
  dragPosition,
  isCroppableImage,
  SOCIAL_SHAPES,
} from "@/app/drive/components/crop-for-social.utils";

const shape = (id: string) => {
  const found = SOCIAL_SHAPES.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("cropRect", () => {
  it("takes the full height of a wide image for a square and slides along x", () => {
    expect(cropRect(2000, 1000, shape("square"), 0)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      axis: "x",
    });
    expect(cropRect(2000, 1000, shape("square"), 0.5).x).toBe(500);
    expect(cropRect(2000, 1000, shape("square"), 1).x).toBe(1000);
  });

  it("takes the full width of a tall image for landscape and slides along y", () => {
    const rect = cropRect(1000, 2000, shape("landscape"), 1);
    expect(rect.width).toBe(1000);
    expect(rect.height).toBe(524);
    expect(rect.y).toBe(2000 - 524);
    expect(rect.axis).toBe("y");
  });

  it("keeps the whole image when it already has the shape", () => {
    expect(cropRect(1080, 1920, shape("story"), 0.7)).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      axis: null,
    });
  });

  it("clamps the position into 0..1", () => {
    expect(cropRect(2000, 1000, shape("square"), -3).x).toBe(0);
    expect(cropRect(2000, 1000, shape("square"), 9).x).toBe(1000);
  });
});

describe("dragPosition", () => {
  // A frame half as wide as the image: its travel is the other half.
  it("centres the frame on a tap outside it", () => {
    expect(dragPosition({ at: 0.6, frame: 0.5, start: null })).toBeCloseTo(0.7);
  });

  it("moves a grabbed frame by the pointer's travel, without a jump", () => {
    expect(
      dragPosition({ at: 0.6, frame: 0.5, start: { at: 0.5, position: 0.5 } }),
    ).toBeCloseTo(0.7);
  });

  it("stops the frame at the image's edges", () => {
    expect(dragPosition({ at: 0, frame: 0.5, start: null })).toBe(0);
    expect(
      dragPosition({ at: 1, frame: 0.5, start: { at: 0.1, position: 0.5 } }),
    ).toBe(1);
  });
});

describe("croppedFileName", () => {
  it("names the copy after the original and the shape", () => {
    expect(
      croppedFileName("Team photo.jpeg", shape("portrait"), "image/jpeg"),
    ).toBe("Team photo-4x5.jpg");
  });

  it("keeps PNG and uses the PNG extension", () => {
    expect(croppedFileName("logo.png", shape("square"), "image/png")).toBe(
      "logo-1x1.png",
    );
  });

  it("saves WebP as PNG, which keeps transparency", () => {
    expect(croppedFileName("cover.webp", shape("story"), "image/webp")).toBe(
      "cover-9x16.png",
    );
  });

  it("shortens a long name so the copy stays within Drive's limit", () => {
    const name = `${"a".repeat(251)}.jpg`;
    const copy = croppedFileName(name, shape("portrait"), "image/jpeg");
    expect(copy).toHaveLength(255);
    expect(copy.endsWith("a-4x5.jpg")).toBe(true);
  });

  it("handles a name without an extension", () => {
    expect(croppedFileName("banner", shape("landscape"), "image/jpeg")).toBe(
      "banner-1.91x1.jpg",
    );
  });
});

describe("isCroppableImage", () => {
  it("accepts raster photos and refuses SVG and GIF", () => {
    expect(isCroppableImage("image/jpeg")).toBe(true);
    expect(isCroppableImage("image/png")).toBe(true);
    expect(isCroppableImage("image/webp")).toBe(true);
    expect(isCroppableImage("image/svg+xml")).toBe(false);
    expect(isCroppableImage("image/gif")).toBe(false);
  });
});
