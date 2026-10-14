import type { GoogleDisplayImage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  GOOGLE_DISPLAY_LIMITS,
  type GoogleDisplayFormValues,
  googleDisplayEditSpecSchema,
  googleDisplayFormSchema,
  googleDisplaySpecSchema,
  toGoogleDisplayEditSpec,
  toGoogleDisplaySpec,
} from "./google-display";
import { driveImagesOnly } from "./google-display-images";

const image = (
  role: GoogleDisplayImage["role"],
  name = `${role}.png`,
): GoogleDisplayImage => ({
  pathname: `drive/users/user_1/${name}`,
  fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/${name}`,
  name,
  size: 240000,
  mimeType: "image/png",
  role,
});

const IMAGES = [image("LANDSCAPE"), image("SQUARE")];

const form: GoogleDisplayFormValues = {
  startDate: "",
  endDate: "",
  locations: [],
  languages: [],
  finalUrl: "https://example.com/spring",
  businessName: "Acme",
  displayHeadlines: ["One"],
  longHeadline: "A longer headline",
  displayDescriptions: ["First description"],
  images: IMAGES,
};

const spec = {
  type: "DISPLAY" as const,
  locationIds: [],
  languageIds: [],
  finalUrl: "https://example.com/spring",
  businessName: "Acme",
  headlines: ["One"],
  longHeadline: "A longer headline",
  descriptions: ["First description"],
  images: IMAGES,
};

function firstIssue(
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
  path: string,
) {
  return result.error?.issues.find((issue) => issue.path.join(".") === path);
}

describe("Core's limits", () => {
  it("come from the API schema", () => {
    expect(GOOGLE_DISPLAY_LIMITS).toMatchObject({
      businessName: 25,
      headlines: { min: 1, max: 5, length: 30 },
      longHeadline: 90,
      descriptions: { min: 1, max: 5, length: 90 },
      images: 8,
    });
  });
});

describe("googleDisplayFormSchema", () => {
  const schema = googleDisplayFormSchema();

  it("accepts a minimal ad", () => {
    expect(schema.safeParse(form).success).toBe(true);
  });

  it.each([
    ["businessName", { businessName: "a".repeat(26) }],
    ["businessName", { businessName: "  " }],
    ["longHeadline", { longHeadline: "a".repeat(91) }],
    ["displayHeadlines.0", { displayHeadlines: ["a".repeat(31)] }],
    ["displayHeadlines.0", { displayHeadlines: [""] }],
    ["displayDescriptions.0", { displayDescriptions: ["a".repeat(91)] }],
    ["finalUrl", { finalUrl: "example.com" }],
  ])("refuses %s: %j", (path, changes) => {
    expect(
      firstIssue(schema.safeParse({ ...form, ...changes }), path),
    ).toBeDefined();
  });

  it("refuses repeated headlines, ignoring case", () => {
    const result = schema.safeParse({
      ...form,
      displayHeadlines: ["Sale", "Free returns", "sale "],
    });
    expect(firstIssue(result, "displayHeadlines.2")).toBeDefined();
    expect(firstIssue(result, "displayHeadlines.0")).toBeUndefined();
  });

  it("refuses an end date before the start date", () => {
    const result = schema.safeParse({
      ...form,
      startDate: "2026-11-02",
      endDate: "2026-11-01",
    });
    expect(firstIssue(result, "endDate")).toBeDefined();
  });

  it("asks for the image that is missing, in the reader's words", () => {
    const words = googleDisplayFormSchema({
      imagesMissing: (missing) => `missing ${missing}`,
    });
    expect(
      firstIssue(words.safeParse({ ...form, images: [] }), "images")?.message,
    ).toBe("missing both");
    expect(
      firstIssue(
        words.safeParse({ ...form, images: [image("SQUARE")] }),
        "images",
      )?.message,
    ).toBe("missing landscape");
    expect(
      firstIssue(
        words.safeParse({ ...form, images: [image("LANDSCAPE")] }),
        "images",
      )?.message,
    ).toBe("missing square");
  });

  it("says too many images, too many logos and a repeated file in the reader's words", () => {
    const words = googleDisplayFormSchema({
      imagesTooMany: (max) => `at most ${max} images`,
      logosTooMany: (max) => `at most ${max} logos`,
      imageRepeated: "each file once",
    });
    const messages = (images: GoogleDisplayImage[]) =>
      words
        .safeParse({ ...form, images })
        .error?.issues.filter(({ path }) => path.join(".") === "images")
        .map(({ message }) => message);
    const seven = [
      ...[1, 2, 3, 4].map((n) => image("LANDSCAPE", `w${n}.png`)),
      ...[1, 2, 3].map((n) => image("SQUARE", `s${n}.png`)),
    ];
    const logos = ["a", "b", "c"].map((n) => image("LOGO", `${n}.png`));

    expect(messages(seven)).toEqual(["at most 6 images"]);
    expect(messages([...IMAGES, ...logos])).toEqual(["at most 2 logos"]);
    expect(messages([...IMAGES, image("LOGO", "LANDSCAPE.png")])).toEqual([
      "each file once",
    ]);
  });

  it("does not count a logo as a landscape or a square image", () => {
    const result = schema.safeParse({
      ...form,
      images: [image("LANDSCAPE"), image("LOGO")],
    });
    expect(firstIssue(result, "images")).toBeDefined();
  });
});

describe("googleDisplaySpecSchema", () => {
  const schema = googleDisplaySpecSchema();

  it("accepts Core's minimum, with and without logos", () => {
    expect(schema.safeParse(spec).success).toBe(true);
    expect(
      schema.safeParse({ ...spec, images: [...IMAGES, image("LOGO")] }).success,
    ).toBe(true);
  });

  it("takes 6 marketing images and 2 logos, and no more", () => {
    const six = [
      ...[1, 2, 3].map((n) => image("LANDSCAPE", `w${n}.png`)),
      ...[1, 2, 3].map((n) => image("SQUARE", `s${n}.png`)),
    ];
    const logos = [image("LOGO", "l1.png"), image("LOGO", "l2.png")];
    expect(
      schema.safeParse({ ...spec, images: [...six, ...logos] }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...spec, images: [...six, image("SQUARE", "s4.png")] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...spec,
        images: [...IMAGES, ...logos, image("LOGO", "l3.png")],
      }).success,
    ).toBe(false);
  });

  it("refuses a file used twice", () => {
    const result = schema.safeParse({
      ...spec,
      images: [...IMAGES, image("LOGO", "LANDSCAPE.png")],
    });
    expect(firstIssue(result, "images")).toBeDefined();
  });

  it("refuses other types and sizes over 5120 KB", () => {
    expect(
      schema.safeParse({
        ...spec,
        images: [{ ...IMAGES[0], mimeType: "image/webp" }, IMAGES[1]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...spec,
        images: [{ ...IMAGES[0], size: 5120 * 1024 + 1 }, IMAGES[1]],
      }).success,
    ).toBe(false);
  });

  it("refuses a SEARCH spec", () => {
    expect(schema.safeParse({ ...spec, type: "SEARCH" }).success).toBe(false);
  });

  it("holds headlines and descriptions to 1 to 5", () => {
    expect(schema.safeParse({ ...spec, headlines: [] }).success).toBe(false);
    expect(
      schema.safeParse({ ...spec, headlines: ["a", "b", "c", "d", "e", "f"] })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...spec, descriptions: [] }).success).toBe(false);
  });
});

describe("toGoogleDisplaySpec", () => {
  it("sends the ad as typed, trimmed, with the images", () => {
    expect(
      toGoogleDisplaySpec({
        ...form,
        finalUrl: " https://example.com/spring ",
        businessName: " Acme ",
        displayHeadlines: [" One ", "Two"],
        longHeadline: " A longer headline ",
        displayDescriptions: [" First description "],
        locations: [{ id: "2276", name: "Germany" }],
        languages: [{ id: "1001", name: "German" }],
        startDate: "2026-11-01",
        images: [...IMAGES, image("LOGO")],
      }),
    ).toEqual({
      ...spec,
      headlines: ["One", "Two"],
      locationIds: ["2276"],
      languageIds: ["1001"],
      startDate: "2026-11-01",
      images: [...IMAGES, image("LOGO")],
    });
  });

  it("leaves out dates that are empty", () => {
    const sent = toGoogleDisplaySpec({ ...form, images: IMAGES });
    expect(sent).not.toHaveProperty("startDate");
    expect(sent).not.toHaveProperty("endDate");
  });
});

const KEPT = {
  assetId: "a1",
  role: "LANDSCAPE" as const,
  url: "https://tpc.googlesyndication.com/a1.png",
};

describe("editing images", () => {
  it("sends a kept image as its asset and role, a new one as the Drive file", () => {
    const square = image("SQUARE");

    expect(
      toGoogleDisplayEditSpec(
        { ...form, images: [KEPT, square] },
        { started: false },
      ).images,
    ).toEqual([{ assetId: "a1", role: "LANDSCAPE" }, square]);
  });

  it("leaves the start date out once the campaign started, so Core keeps it", () => {
    const dated = { ...form, startDate: "2026-11-01", endDate: "2026-11-30" };

    expect(toGoogleDisplayEditSpec(dated, { started: false })).toHaveProperty(
      "startDate",
      "2026-11-01",
    );
    const sent = toGoogleDisplayEditSpec(dated, { started: true });
    expect(sent).not.toHaveProperty("startDate");
    expect(sent).toHaveProperty("endDate", "2026-11-30");
  });

  it("does not turn a kept image into a create's Drive file", () => {
    expect(driveImagesOnly(IMAGES)).toEqual(IMAGES);
    expect(() => driveImagesOnly([KEPT, ...IMAGES])).toThrow(
      "A new campaign has no kept images",
    );
  });

  it("lets the form hold kept images and counts their roles", () => {
    const schema = googleDisplayFormSchema();

    expect(
      schema.safeParse({ ...form, images: [KEPT, image("SQUARE")] }).success,
    ).toBe(true);
    expect(
      firstIssue(schema.safeParse({ ...form, images: [KEPT] }), "images"),
    ).toBeDefined();
  });

  it("refuses a kept image twice", () => {
    const result = googleDisplayFormSchema().safeParse({
      ...form,
      images: [KEPT, KEPT, image("SQUARE")],
    });

    expect(firstIssue(result, "images")).toBeDefined();
  });

  it("is accepted by the edit spec only", () => {
    const sent = {
      ...spec,
      images: [{ assetId: "a1", role: "LANDSCAPE" }, image("SQUARE")],
    };

    expect(googleDisplayEditSpecSchema().safeParse(sent).success).toBe(true);
    expect(googleDisplaySpecSchema().safeParse(sent).success).toBe(false);
  });
});
