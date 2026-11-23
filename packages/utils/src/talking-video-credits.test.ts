import { describe, expect, it } from "vitest";

import {
  creditsPerShortVideoCents,
  creditsPerTalkingVideoCents,
  TALKING_VIDEO_PLANNED_CREDITS,
  TALKING_VIDEO_PRICE,
  talkingVideoQuotedSeconds,
} from "./talking-video-credits";

const price = {
  perSecondUsd: 0.05,
  voicePer1000CharactersUsd: 0.08,
  captionsPerMinuteUsd: 0.03,
  cutoutPerSecondUsd: 0.0067,
  brollUsd: 0.5,
  musicUsd: 0.1,
};

describe("talkingVideoQuotedSeconds", () => {
  it("quotes a script at thirteen characters a second, rounded up", () => {
    expect(talkingVideoQuotedSeconds("a".repeat(130))).toBe(10);
    expect(talkingVideoQuotedSeconds("a".repeat(131))).toBe(11);
  });

  it("never quotes less than three seconds", () => {
    expect(talkingVideoQuotedSeconds("Hi.")).toBe(3);
  });

  it("leaves audio tags out, because they are not spoken", () => {
    expect(talkingVideoQuotedSeconds(`[excited] ${"a".repeat(130)}`)).toBe(10);
  });
});

describe("creditsPerTalkingVideoCents", () => {
  it("adds the video, the voice and the captions, rounded up", () => {
    // 10 s: 50 cents of video, 1.04 of voice, 0.5 of captions.
    expect(creditsPerTalkingVideoCents(price, "a".repeat(130))).toBe(52);
  });

  it("charges a short video by its seconds, with no minimum", () => {
    // 3 s: 15 cents of video, 0.31 of voice, 0.15 of captions.
    expect(creditsPerTalkingVideoCents(price, "a".repeat(39))).toBe(16);
  });

  it("adds the cut-out when the site is shown", () => {
    // 10 s: 6.7 cents on top of 51.54.
    expect(
      creditsPerTalkingVideoCents(price, "a".repeat(130), { siteShots: true }),
    ).toBe(59);
  });

  it("adds the B-roll clip and the music when they are asked for", () => {
    const script = "a".repeat(130);
    expect(creditsPerTalkingVideoCents(price, script, { broll: true })).toBe(
      102,
    );
    expect(creditsPerTalkingVideoCents(price, script, { music: true })).toBe(
      62,
    );
  });

  it("doubles the video part on a model at twice the price", () => {
    expect(
      creditsPerTalkingVideoCents(
        { ...price, perSecondUsd: 0.1 },
        "a".repeat(130),
      ),
    ).toBe(102);
  });
});

describe("TALKING_VIDEO_PLANNED_CREDITS", () => {
  it("prices the scripts bots are asked to write at fal's billed figures", () => {
    // 150 characters: 12 s, 60 cents of video, 1.2 of voice, 0.16 of captions.
    expect(TALKING_VIDEO_PLANNED_CREDITS.shortest).toBe(62);
    // 400 characters with the site: 31 s, 155 + 3.2 + 0.41 + 31.5 of cut-out.
    expect(TALKING_VIDEO_PLANNED_CREDITS.longest).toBe(191);
    expect(TALKING_VIDEO_PLANNED_CREDITS.perCharacter).toBeCloseTo(0.4, 1);
    expect(TALKING_VIDEO_PLANNED_CREDITS.sitePerCharacter).toBeCloseTo(0.1, 1);
  });
});

describe("creditsPerShortVideoCents", () => {
  const script = "x".repeat(300);

  it("charges music, the voice and timing its words for a spoken short", () => {
    // $0.10 + 300 characters at $0.08 per 1,000 + 24 s at $0.008 a minute.
    expect(
      creditsPerShortVideoCents(TALKING_VIDEO_PRICE, script, "voiceover"),
    ).toBe(13);
  });

  it("charges only the music for a slideshow, which speaks nothing", () => {
    expect(
      creditsPerShortVideoCents(TALKING_VIDEO_PRICE, script, "slideshow"),
    ).toBe(10);
  });
});
