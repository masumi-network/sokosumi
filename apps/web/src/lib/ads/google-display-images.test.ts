import type { GoogleDisplayImage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  addDisplayImage,
  checkDisplayImageFile,
  DISPLAY_IMAGE_MAX_BYTES,
  DISPLAY_IMAGE_RULES,
  displayImageCounts,
  imageRoleForSize,
  missingDisplayImages,
} from "./google-display-images";

function image(
  role: GoogleDisplayImage["role"],
  name = `${role}.png`,
): GoogleDisplayImage {
  return {
    pathname: `drive/users/user_1/${name}`,
    fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/${name}`,
    name,
    size: 1000,
    mimeType: "image/png",
    role,
  };
}

describe("Core's limits", () => {
  it("come from the API schema where it states them", () => {
    expect(DISPLAY_IMAGE_MAX_BYTES).toBe(5120 * 1024);
    expect(DISPLAY_IMAGE_RULES).toMatchObject({ maxMarketing: 6, maxLogos: 2 });
  });
});

describe("imageRoleForSize", () => {
  it.each([
    ["the exact landscape minimum", 600, 314, "LANDSCAPE"],
    ["a large 1.91:1", 1200, 628, "LANDSCAPE"],
    ["just inside 2% under 1.91", 1000, 534, "LANDSCAPE"], // 1.873
    ["just inside 2% over 1.91", 1000, 514, "LANDSCAPE"], // 1.945
    ["a square", 1200, 1200, "SQUARE"],
    ["the exact square minimum", 300, 300, "SQUARE"],
    ["a square plus 2%", 510, 500, "SQUARE"],
    ["a square less 2%", 490, 500, "SQUARE"], // 0.98
  ] as const)("takes %s as %s", (_name, width, height, role) => {
    expect(imageRoleForSize(width, height, "images")).toEqual({
      ok: true,
      role,
    });
  });

  it.each([
    ["just outside 2% under 1.91", 1000, 535], // 1.869
    ["just outside 2% over 1.91", 1000, 513], // 1.949
    ["just over 2% from square", 515, 500],
    ["a 4:3 photo", 1200, 900],
    ["a portrait", 600, 900],
    ["a wide banner", 1600, 400],
  ])("refuses %s by its ratio", (_name, width, height) => {
    expect(imageRoleForSize(width, height, "images")).toEqual({
      ok: false,
      reason: "ratio",
    });
  });

  it("refuses a landscape or a square under its minimum size", () => {
    expect(imageRoleForSize(599, 314, "images")).toEqual({
      ok: false,
      reason: "landscapeTooSmall",
    });
    expect(imageRoleForSize(600, 313, "images")).toEqual({
      ok: false,
      reason: "landscapeTooSmall",
    });
    expect(imageRoleForSize(299, 299, "images")).toEqual({
      ok: false,
      reason: "squareTooSmall",
    });
  });

  describe("in the logo slot", () => {
    it("takes a square, even one a marketing square would refuse", () => {
      expect(imageRoleForSize(128, 128, "logo")).toEqual({
        ok: true,
        role: "LOGO",
      });
      expect(imageRoleForSize(1024, 1024, "logo")).toEqual({
        ok: true,
        role: "LOGO",
      });
      expect(imageRoleForSize(510, 500, "logo")).toEqual({
        ok: true,
        role: "LOGO",
      });
    });

    it("refuses anything that is not square, a landscape included", () => {
      expect(imageRoleForSize(1200, 628, "logo")).toEqual({
        ok: false,
        reason: "logoRatio",
      });
      expect(imageRoleForSize(515, 500, "logo")).toEqual({
        ok: false,
        reason: "logoRatio",
      });
    });

    it("refuses a logo under 128 x 128", () => {
      expect(imageRoleForSize(127, 127, "logo")).toEqual({
        ok: false,
        reason: "logoTooSmall",
      });
    });
  });
});

describe("checkDisplayImageFile", () => {
  it.each([
    ["a.jpg", "image/jpeg", "image/jpeg"],
    ["a.png", "image/png", "image/png"],
    ["a.gif", "image/gif", "image/gif"],
    // A Drive file has no type: its extension tells.
    ["photo.JPEG", "", "image/jpeg"],
    ["photo.png", "", "image/png"],
  ])("takes %s (%s)", (name, type, mimeType) => {
    expect(checkDisplayImageFile({ name, type, size: 1000 })).toEqual({
      ok: true,
      mimeType,
    });
  });

  it.each([
    ["a.webp", "image/webp"],
    ["a.svg", "image/svg+xml"],
    ["a.pdf", ""],
    ["noextension", ""],
  ])("refuses %s (%s) by its type", (name, type) => {
    expect(checkDisplayImageFile({ name, type, size: 1000 })).toEqual({
      ok: false,
      reason: "type",
    });
  });

  it("refuses a file over 5120 KB and takes one of exactly 5120 KB", () => {
    expect(
      checkDisplayImageFile({
        name: "a.png",
        type: "image/png",
        size: DISPLAY_IMAGE_MAX_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: "tooLarge" });
    expect(
      checkDisplayImageFile({
        name: "a.png",
        type: "image/png",
        size: DISPLAY_IMAGE_MAX_BYTES,
      }).ok,
    ).toBe(true);
  });
});

describe("counts and what is missing", () => {
  it("counts each role and the marketing images together", () => {
    expect(
      displayImageCounts([
        image("LANDSCAPE", "a.png"),
        image("LANDSCAPE", "b.png"),
        image("SQUARE"),
        image("LOGO"),
      ]),
    ).toEqual({ landscape: 2, square: 1, marketing: 3, logo: 1 });
  });

  it("says which of landscape and square an ad still needs", () => {
    expect(missingDisplayImages([])).toBe("both");
    expect(missingDisplayImages([image("LOGO")])).toBe("both");
    expect(missingDisplayImages([image("SQUARE")])).toBe("landscape");
    expect(missingDisplayImages([image("LANDSCAPE")])).toBe("square");
    expect(
      missingDisplayImages([image("LANDSCAPE"), image("SQUARE")]),
    ).toBeNull();
  });
});

describe("addDisplayImage", () => {
  it("adds an image after the others", () => {
    const first = image("LANDSCAPE");
    const second = image("SQUARE");
    expect(addDisplayImage([first], second)).toEqual({
      ok: true,
      images: [first, second],
    });
  });

  it("refuses a file that is already in, in any role", () => {
    const first = image("LANDSCAPE", "same.png");
    expect(addDisplayImage([first], image("LOGO", "same.png"))).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("stops at 6 landscape and square images, but still takes logos", () => {
    const six = [
      ...[1, 2, 3].map((n) => image("LANDSCAPE", `wide-${n}.png`)),
      ...[1, 2, 3].map((n) => image("SQUARE", `square-${n}.png`)),
    ];
    expect(addDisplayImage(six, image("SQUARE", "more.png"))).toEqual({
      ok: false,
      reason: "full",
    });
    expect(addDisplayImage(six, image("LOGO", "logo.png")).ok).toBe(true);
  });

  it("stops at 2 logos", () => {
    const two = [image("LOGO", "a.png"), image("LOGO", "b.png")];
    expect(addDisplayImage(two, image("LOGO", "c.png"))).toEqual({
      ok: false,
      reason: "full",
    });
    expect(addDisplayImage(two, image("SQUARE", "d.png")).ok).toBe(true);
  });
});
