import { describe, expect, it } from "vitest";

import {
  setVoiceTranscript,
  splitVoiceTranscript,
  voiceWaveformPeaks,
} from "./voice-message";

const LINK = "[Voice message.m4a](https://blob.example/v.m4a)";

describe("voice transcript", () => {
  it("adds, reads and replaces the transcript after the link", () => {
    const withText = setVoiceTranscript(LINK, "  Ship it on Friday. ");
    expect(withText).toBe(
      `${LINK}\n\n\`\`\`transcript\nShip it on Friday.\n\`\`\``,
    );
    expect(splitVoiceTranscript(withText)).toEqual({
      content: LINK,
      transcript: "Ship it on Friday.",
    });
    const replaced = setVoiceTranscript(withText, "Monday instead.");
    expect(splitVoiceTranscript(replaced).transcript).toBe("Monday instead.");
    expect(replaced.match(/transcript/g)).toHaveLength(1);
  });

  it("removes the transcript when it is emptied", () => {
    expect(setVoiceTranscript(setVoiceTranscript(LINK, "x"), " \n")).toBe(LINK);
  });

  it("keeps a caption and fences text that contains backticks", () => {
    const content = setVoiceTranscript(
      `${LINK}\n\nListen to this`,
      "run ```pnpm check``` first",
    );
    expect(content).toContain("````transcript\n");
    expect(splitVoiceTranscript(content)).toEqual({
      content: `${LINK}\n\nListen to this`,
      transcript: "run ```pnpm check``` first",
    });
  });

  it("leaves other code blocks alone", () => {
    const content = `${LINK}\n\n\`\`\`ts\nconst a = 1;\n\`\`\``;
    expect(splitVoiceTranscript(content)).toEqual({
      content,
      transcript: null,
    });
  });
});

describe("voiceWaveformPeaks", () => {
  it("scales each slice's peak to the loudest", () => {
    const samples = new Float32Array([0, 0.125, -0.5, 0.25, 0, 0]);
    expect(voiceWaveformPeaks(samples, 3)).toEqual([0.25, 1, 0]);
  });

  it("returns nothing for no samples and zeros for silence", () => {
    expect(voiceWaveformPeaks(new Float32Array(), 4)).toEqual([]);
    expect(voiceWaveformPeaks(new Float32Array(8), 2)).toEqual([0, 0]);
  });
});
