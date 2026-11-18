import { describe, expect, it } from "vitest";

import {
  creditsPerTalkingVideoCents,
  talkingVideoQuotedSeconds,
} from "./talking-video-credits";

const price = {
  perSecondUsd: 0.05,
  voicePer1000CharactersUsd: 0.08,
  captionsPerMinuteUsd: 0.03,
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

  it("doubles the video part on a model at twice the price", () => {
    expect(
      creditsPerTalkingVideoCents(
        { ...price, perSecondUsd: 0.1 },
        "a".repeat(130),
      ),
    ).toBe(102);
  });
});
