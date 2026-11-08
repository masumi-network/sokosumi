import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getEnv: () => ({ FAL_KEY: "key" }) }));
vi.mock("@/lib/image-studio/fal-client", () => ({
  downloadMedia: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "audio/mpeg",
  })),
}));

const { sentenceStarts, speakVoiceover } = await import("./voiceover");

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

describe("speakVoiceover", () => {
  const audio = { url: "https://v3b.fal.media/files/x/output.mp3" };
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the audio when the timings come in a shape it does not know", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ audio, timestamps: [{ char: "H", t: 0 }, "x"] }),
    );
    const spoken = await speakVoiceover({ text: "Hi." });
    expect(spoken.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(spoken.sentences).toEqual([]);
    expect(spoken.durationSeconds).toBeNull();
  });

  it("reads start_time and end_time timings", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        audio,
        timestamps: [
          { word: "Hi.", start_time: 0.2, end_time: 0.5 },
          { word: "Go", start_time: 0.8, end_time: 1.25 },
        ],
      }),
    );
    const spoken = await speakVoiceover({ text: "Hi. Go" });
    expect(spoken.durationSeconds).toBe(1.25);
    expect(spoken.sentences).toEqual([
      { start: 0.2, text: "Hi." },
      { start: 0.8, text: "Go" },
    ]);
  });

  it("says what the voice service refused", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"detail":"voice not found"}', { status: 422 }),
    );
    await expect(speakVoiceover({ text: "Hi." })).rejects.toThrow(
      '422: {"detail":"voice not found"}',
    );
  });
});
