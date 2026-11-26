import { describe, expect, it } from "vitest";

import {
  CMO_SHAPED_VIDEO_TARGETS,
  CMO_VIDEO_SHAPES_SKILL,
  cmoOfferedFormats,
  cmoShapedVideoTarget,
  cmoVideoShape,
  isCmoChannelFormat,
  normalizeCmoChannelFormat,
} from "./cmo-channels.js";

describe("videos in other shapes", () => {
  it("are never a plan's own entry: no menu offers them and the save check refuses them", () => {
    for (const target of Object.values(CMO_SHAPED_VIDEO_TARGETS)) {
      expect(cmoOfferedFormats(target.channel)).not.toContain(target.format);
      expect(isCmoChannelFormat(target.channel, target.format)).toBe(false);
    }
    expect(cmoOfferedFormats("instagram")).toContain("reel");
  });

  it("are posted in their own shape, the rest as before", () => {
    expect(cmoVideoShape("x", "video")).toBe("16:9");
    expect(cmoVideoShape("youtube", "video")).toBe("16:9");
    expect(cmoVideoShape("instagram", "feed_video")).toBe("4:5");
    expect(cmoVideoShape("facebook", "feed_video")).toBe("4:5");
    expect(cmoVideoShape("linkedin", "wide_video")).toBe("16:9");
    expect(cmoVideoShape("linkedin", "talking_video")).toBe("4:5");
    expect(cmoVideoShape("instagram", "reel")).toBe("9:16");
    expect(cmoVideoShape("tiktok", "talking_video")).toBe("9:16");
  });

  it("are named in alsoOn by a target each, behind one version skill", () => {
    expect(CMO_VIDEO_SHAPES_SKILL).toBe("cmo-video-shapes");
    expect(cmoShapedVideoTarget("instagram_feed")).toEqual({
      channel: "instagram",
      format: "feed_video",
    });
    expect(cmoShapedVideoTarget("instagram")).toBeNull();
  });

  it("leaves what Cuso writes guessed as before, never as a copy-only format", () => {
    expect(normalizeCmoChannelFormat("youtube", "video")).toEqual({
      channel: "youtube",
      format: "short",
    });
    expect(normalizeCmoChannelFormat("instagram", "feed video")).toEqual({
      channel: "instagram",
      format: "reel",
    });
  });
});

describe("CMO channels", () => {
  it("offers only formats the publishers support", () => {
    expect(isCmoChannelFormat("instagram", "image")).toBe(true);
    expect(isCmoChannelFormat("instagram", "carousel")).toBe(true);
    expect(isCmoChannelFormat("facebook", "carousel")).toBe(false);
    expect(isCmoChannelFormat("x", "thread")).toBe(false);
    // TikTok takes video only, through its own publisher.
    expect(isCmoChannelFormat("tiktok", "video")).toBe(true);
    expect(isCmoChannelFormat("tiktok", "talking_video")).toBe(true);
    expect(isCmoChannelFormat("tiktok", "image")).toBe(false);
    // Videos come from Content Studio; YouTube takes only Shorts.
    expect(isCmoChannelFormat("youtube", "short")).toBe(true);
    expect(isCmoChannelFormat("instagram", "reel")).toBe(true);
    expect(isCmoChannelFormat("linkedin", "video")).toBe(true);
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
    expect(normalizeCmoChannelFormat("instagram", "Slides")).toEqual({
      channel: "instagram",
      format: "carousel",
    });
    // A carousel is not a single image: no silent swap, the save check asks.
    expect(normalizeCmoChannelFormat("facebook", "carousel")).toEqual({
      channel: "facebook",
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
    expect(normalizeCmoChannelFormat("instagram", "Video")).toEqual({
      channel: "instagram",
      format: "reel",
    });
    expect(normalizeCmoChannelFormat("youtube", "video")).toEqual({
      channel: "youtube",
      format: "short",
    });
  });

  it("leaves channels Cuso does not run for the save check to name", () => {
    expect(normalizeCmoChannelFormat("reddit", "thread")).toEqual({
      channel: "reddit",
      format: "thread",
    });
  });
});
