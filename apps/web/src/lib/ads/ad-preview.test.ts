import { describe, expect, it } from "vitest";

import {
  displayAdPreview,
  previewVariants,
  rotateTexts,
  searchAdPreview,
} from "./ad-preview";

describe("rotateTexts", () => {
  it("takes the filled texts, trimmed, from the variant on, wrapping", () => {
    expect(rotateTexts([" One ", "", "Two", "Three"], 0, 2)).toEqual([
      "One",
      "Two",
    ]);
    expect(rotateTexts(["One", "Two", "Three"], 2, 2)).toEqual([
      "Three",
      "One",
    ]);
  });

  it("never repeats a text when there are fewer than asked for", () => {
    expect(rotateTexts(["One", "Two"], 1, 3)).toEqual(["Two", "One"]);
  });

  it("is empty with nothing filled in", () => {
    expect(rotateTexts(["", "  "], 0, 3)).toEqual([]);
  });
});

describe("previewVariants", () => {
  it("counts one variant per text of the longest list, at least one", () => {
    expect(previewVariants(["a", "b", ""], ["c"])).toBe(2);
    expect(previewVariants([], [""])).toBe(1);
  });
});

const SEARCH = {
  finalUrl: "https://www.example.com/shoes",
  path1: "running",
  path2: "",
  headlines: ["Fast shoes", "Free returns", "Shop now", "New season"],
  descriptions: ["Light and quick.", "Order today.", ""],
  sitelinks: [
    {
      text: "Sale",
      finalUrl: "https://example.com/sale",
      description1: "",
      description2: "",
    },
    { text: "", finalUrl: "", description1: "", description2: "" },
  ],
  callouts: ["Free shipping", " ", "24/7 support"],
};

describe("searchAdPreview", () => {
  it("joins three headlines and two descriptions, as Google shows them", () => {
    expect(searchAdPreview(SEARCH, 0)).toEqual({
      displayUrl: "example.com/running",
      domain: "example.com",
      headline: "Fast shoes | Free returns | Shop now",
      description: "Light and quick. Order today.",
      sitelinks: ["Sale"],
      callouts: ["Free shipping", "24/7 support"],
      variants: 4,
    });
  });

  it("shows another combination for the next variant", () => {
    expect(searchAdPreview(SEARCH, 1).headline).toBe(
      "Free returns | Shop now | New season",
    );
    expect(searchAdPreview(SEARCH, 1).description).toBe(
      "Order today. Light and quick.",
    );
  });
});

const DISPLAY = {
  finalUrl: "https://example.com",
  businessName: " Acme ",
  displayHeadlines: ["Run more", "Free returns"],
  longHeadline: " Shoes for every run ",
  displayDescriptions: ["Order today", ""],
  images: [
    { role: "LANDSCAPE" as const, url: "https://img/wide-1.png" },
    { role: "SQUARE" as const, url: "https://img/square.png" },
    { role: "LANDSCAPE" as const, url: "https://img/wide-2.png" },
    { role: "LOGO" as const, url: "https://img/logo.png" },
  ],
};

describe("displayAdPreview", () => {
  it("picks one headline, description and image of each shape", () => {
    expect(displayAdPreview(DISPLAY, 0)).toEqual({
      businessName: "Acme",
      domain: "example.com",
      headline: "Run more",
      longHeadline: "Shoes for every run",
      description: "Order today",
      landscape: "https://img/wide-1.png",
      square: "https://img/square.png",
      logo: "https://img/logo.png",
      variants: 2,
    });
  });

  it("rotates headlines and images together for the next variant", () => {
    const next = displayAdPreview(DISPLAY, 1);
    expect(next.headline).toBe("Free returns");
    expect(next.landscape).toBe("https://img/wide-2.png");
    expect(next.square).toBe("https://img/square.png");
  });

  it("has no picture of a shape it was not given", () => {
    const bare = displayAdPreview({ ...DISPLAY, images: [] }, 0);
    expect(bare.landscape).toBeNull();
    expect(bare.square).toBeNull();
    expect(bare.logo).toBeNull();
  });
});
