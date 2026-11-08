import { describe, expect, it } from "vitest";
import { sentenceStarts } from "./voiceover";

describe("sentenceStarts", () => {
  it("groups word timings into sentences", () => {
    expect(
      sentenceStarts([
        { text: "New", start: 0.1 },
        { text: "in", start: 0.3 },
        { text: "Sokosumi.", start: 0.45 },
        { text: "Contacts", start: 1.2 },
        { text: "search!", start: 1.6 },
      ]),
    ).toEqual([
      { start: 0.1, text: "New in Sokosumi." },
      { start: 1.2, text: "Contacts search!" },
    ]);
  });

  it("reads character timings the same way", () => {
    const timings = [..."Hi. Go"].map((text, index) => ({
      text,
      start: index / 10,
    }));
    expect(sentenceStarts(timings)).toEqual([
      { start: 0, text: "Hi." },
      { start: 0.4, text: "Go" },
    ]);
  });
});
