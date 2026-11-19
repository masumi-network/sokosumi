import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getEnv: () => ({ FAL_KEY: "key" }) }));

const { timeSpokenWords, withScriptSpelling } = await import(
  "./talking-video-words"
);

const HEARD = [
  { text: "Calcom", start: 0.1, end: 0.6 },
  { text: "works.", start: 0.7, end: 1.1 },
];

describe("withScriptSpelling", () => {
  it("keeps the script's spelling when the words line up", () => {
    expect(withScriptSpelling(HEARD, "[excited] Cal.com works.")).toEqual([
      { text: "Cal.com", start: 0.1, end: 0.6 },
      { text: "works.", start: 0.7, end: 1.1 },
    ]);
  });

  it("keeps the transcript when the script has another number of words", () => {
    expect(withScriptSpelling(HEARD, "Cal.com just works.")).toEqual(HEARD);
  });
});

describe("timeSpokenWords", () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const input = {
    audioUrl: "https://v3b.fal.media/files/voice.mp3",
    script: "Cal.com works.",
    languageCode: "en",
  };

  it("returns the spoken words and leaves the spaces between them out", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        words: [
          { text: "Calcom", type: "word", start: 0.1, end: 0.6 },
          { text: " ", type: "spacing", start: 0.6, end: 0.7 },
          { text: "works.", type: "word", start: 0.7, end: 1.1 },
        ],
      }),
    );

    expect(await timeSpokenWords(input)).toEqual([
      { text: "Cal.com", start: 0.1, end: 0.6 },
      { text: "works.", start: 0.7, end: 1.1 },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      audio_url: input.audioUrl,
      language_code: "en",
      tag_audio_events: false,
      diarize: false,
    });
  });

  it("returns no words when the service refuses or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    expect(await timeSpokenWords(input)).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await timeSpokenWords(input)).toEqual([]);
  });
});
