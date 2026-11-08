import { z } from "zod";
import { getEnv } from "@/config/env";
import { downloadMedia } from "@/lib/image-studio/fal-client";

/** ElevenLabs' expressive model on fal: delivery steered by audio tags. */
export const VOICEOVER_MODEL = "elevenlabs/tts/eleven-v4";
/** fal's price for it, per 1,000 characters (November 2026). */
const USD_PER_1000_CHARACTERS = 0.08;
const DEFAULT_VOICE = "Brian";
const SPEAK_TIMEOUT_MS = 120_000;
/** A 5,000-character mp3 at 128 kbps is about 5 MB. */
const MAX_AUDIO_BYTES = 25_000_000;

/** fal types `timestamps` as untyped items: read what each one has. */
const responseSchema = z.object({
  audio: z.object({ url: z.string().url() }),
  timestamps: z.array(z.unknown()).nullish(),
});

const timingSchema = z.object({
  text: z.string().optional(),
  word: z.string().optional(),
  character: z.string().optional(),
  start: z.number().optional(),
  start_time: z.number().optional(),
  end: z.number().optional(),
  end_time: z.number().optional(),
});

/** One timing in a shape we know, or null for one we don't. */
function readTiming(
  raw: unknown,
): { text: string; start: number; end: number } | null {
  const parsed = timingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { text, word, character, start, start_time, end, end_time } =
    parsed.data;
  const begins = start ?? start_time;
  const ends = end ?? end_time;
  if (begins === undefined || ends === undefined) return null;
  return { text: text ?? word ?? character ?? "", start: begins, end: ends };
}

export interface Voiceover {
  bytes: Uint8Array;
  costUsd: number;
  durationSeconds: number | null;
  /** When each sentence starts, for timing scenes to the narration. */
  sentences: { start: number; text: string }[];
}

/** Speaks `text` and returns the mp3 with its timing. */
export async function speakVoiceover(input: {
  text: string;
  voice?: string;
  languageCode?: string;
}): Promise<Voiceover> {
  const key = getEnv().FAL_KEY;
  if (!key) throw new Error("Voice-overs are not configured");
  const response = await fetch(`https://fal.run/${VOICEOVER_MODEL}`, {
    method: "POST",
    headers: {
      authorization: `Key ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      voice: input.voice ?? DEFAULT_VOICE,
      ...(input.languageCode ? { language_code: input.languageCode } : {}),
      output_format: "mp3_44100_128",
      timestamps: true,
    }),
    signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
  });
  if (!response.ok) {
    // fal's error says what was wrong with the request (a voice, the text).
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `The voice service answered ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The voice service sent no audio");
  const { bytes } = await downloadMedia(
    parsed.data.audio.url,
    MAX_AUDIO_BYTES,
    "audio/mpeg",
  );
  const timings = (parsed.data.timestamps ?? [])
    .map(readTiming)
    .filter((timing) => timing !== null);
  return {
    bytes,
    costUsd: (input.text.length / 1000) * USD_PER_1000_CHARACTERS,
    durationSeconds:
      timings.length > 0 ? round(timings.at(-1)?.end ?? 0) : null,
    sentences: sentenceStarts(timings),
  };
}

/**
 * Groups timings into sentences, each with the time it starts. The model
 * times words or single characters; both read the same way here.
 */
export function sentenceStarts(
  timings: readonly { text: string; start: number }[],
): { start: number; text: string }[] {
  const byCharacter = timings.every((timing) => timing.text.length <= 1);
  const sentences: { start: number; text: string }[] = [];
  let start: number | null = null;
  let text = "";
  const close = () => {
    if (start !== null && text.trim())
      sentences.push({ start: round(start), text: text.trim() });
    start = null;
    text = "";
  };
  for (const timing of timings) {
    if (!timing.text.trim() && start === null) continue;
    start ??= timing.start;
    text += byCharacter ? timing.text : `${timing.text} `;
    if (/[.!?]["')\]]*$/.test(timing.text.trim())) close();
  }
  close();
  return sentences;
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
