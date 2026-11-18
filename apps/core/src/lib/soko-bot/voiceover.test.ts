import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getEnv: () => ({ FAL_KEY: "key" }) }));
vi.mock("@/lib/image-studio/fal-client", () => ({
  downloadMedia: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "audio/mpeg",
  })),
}));

const { sentenceStarts, speakVoiceover, VoiceoverRefusedError } = await import(
  "./voiceover"
);

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

  it("reads fal's chunks of characters, as eleven-v4 answered on 2026-11-18", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        audio,
        timestamps: [
          {
            characters: ["H", "i", " ", "t", "h", "e", "r", "e", ".", " "],
            character_start_times_seconds: [
              0.0, 0.18, 0.24, 0.4, 0.432, 0.464, 0.496, 0.528, 0.56, 0.76,
            ],
            character_end_times_seconds: [
              0.18, 0.24, 0.4, 0.432, 0.464, 0.496, 0.528, 0.56, 0.76, 0.96,
            ],
          },
          {
            characters: ["S", "e", "c", "o", "n", "d"],
            character_start_times_seconds: [
              0.96, 1.013, 1.067, 1.1199999999999999, 1.173, 1.2269999999999999,
            ],
            character_end_times_seconds: [
              1.013, 1.067, 1.1199999999999999, 1.173, 1.2269999999999999, 1.28,
            ],
          },
          {
            characters: ["!", " ", "I", "s", " ", "i", "t", "?"],
            character_start_times_seconds: [
              2.0, 2.2, 2.4, 2.48, 2.56, 2.64, 2.68, 3.12,
            ],
            character_end_times_seconds: [
              2.2, 2.4, 2.48, 2.56, 2.64, 2.68, 2.7199999999999998,
              3.3600000000000003,
            ],
          },
          {
            characters: [],
            character_start_times_seconds: [],
            character_end_times_seconds: [],
          },
        ],
      }),
    );
    const spoken = await speakVoiceover({ text: "Hi there. Second! Is it?" });
    expect(spoken.durationSeconds).toBe(3.36);
    expect(spoken.sentences).toEqual([
      { start: 0, text: "Hi there." },
      { start: 0.96, text: "Second!" },
      { start: 2.4, text: "Is it?" },
    ]);
  });

  it("says what the voice service refused, and that nothing was billed", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"detail":"busy"}', { status: 503 }),
    );
    const refused = speakVoiceover({ text: "Hi." });
    await expect(refused).rejects.toThrow('503: {"detail":"busy"}');
    await expect(refused).rejects.toBeInstanceOf(VoiceoverRefusedError);
  });

  it("does not call a 422 unbilled, since fal may charge it", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"detail":"voice not found"}', { status: 422 }),
    );
    const failed = speakVoiceover({ text: "Hi." });
    await expect(failed).rejects.toThrow('422: {"detail":"voice not found"}');
    await expect(failed).rejects.not.toBeInstanceOf(VoiceoverRefusedError);
  });

  it("does not call a failure after the voice was made a refusal", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ audio }));
    const { downloadMedia } = await import("@/lib/image-studio/fal-client");
    vi.mocked(downloadMedia).mockRejectedValueOnce(
      new Error("download failed"),
    );
    const failed = speakVoiceover({ text: "Hi." });
    await expect(failed).rejects.toThrow("download failed");
    await expect(failed).rejects.not.toBeInstanceOf(VoiceoverRefusedError);
  });
});
