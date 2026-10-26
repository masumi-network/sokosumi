import { describe, expect, it } from "vitest";

import {
  isCmoChannelFormat,
  normalizeCmoChannelFormat,
} from "./cmo-channels.js";

describe("CMO channels", () => {
  it("offers only formats the publishers support", () => {
    expect(isCmoChannelFormat("instagram", "image")).toBe(true);
    expect(isCmoChannelFormat("instagram", "carousel")).toBe(false);
    expect(isCmoChannelFormat("x", "thread")).toBe(false);
    expect(isCmoChannelFormat("tiktok", "video")).toBe(false);
  });

  it("maps older plans onto today's channels and formats", () => {
    expect(normalizeCmoChannelFormat("Website", "article")).toEqual({
      channel: "seo",
      format: "article",
    });
    expect(normalizeCmoChannelFormat("twitter", "thread")).toEqual({
      channel: "x",
      format: "reply",
    });
    expect(normalizeCmoChannelFormat("linkedin", "Carousel")).toEqual({
      channel: "linkedin",
      format: "images",
    });
    // A carousel is not a single image: no silent swap, the save check asks.
    expect(normalizeCmoChannelFormat("instagram", "carousel")).toEqual({
      channel: "instagram",
      format: "carousel",
    });
    expect(normalizeCmoChannelFormat("linkedin", "unicorn")).toEqual({
      channel: "linkedin",
      format: "unicorn",
    });
    expect(normalizeCmoChannelFormat("ads", "ad")).toEqual({
      channel: "meta_ads",
      format: "image_ad",
    });
    expect(normalizeCmoChannelFormat("newsletter", "newsletter")).toEqual({
      channel: "newsletter",
      format: "issue",
    });
    expect(normalizeCmoChannelFormat("seo", "meta description")).toEqual({
      channel: "seo",
      format: "page_fix",
    });
  });

  it("leaves channels Cuso does not run for the save check to name", () => {
    expect(normalizeCmoChannelFormat("youtube", "video")).toEqual({
      channel: "youtube",
      format: "video",
    });
  });
});
