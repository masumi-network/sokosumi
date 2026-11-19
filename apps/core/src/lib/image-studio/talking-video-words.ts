import { z } from "zod";

import { getEnv } from "@/config/env";

import { TALKING_VIDEO_WORDS_ENDPOINT } from "./talking-video";
import type { SpokenWord } from "./talking-video-edit";

const TIMEOUT_MS = 60_000;

const responseSchema = z.object({
  words: z.array(
    z.object({
      text: z.string(),
      type: z.string(),
      start: z.number().nullish(),
      end: z.number().nullish(),
    }),
  ),
});

/** Bracketed audio tags such as `[excited]` steer the voice and are not spoken. */
function scriptWords(script: string): string[] {
  return script
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The transcript's timings with the script's own spelling, when both have the
 * same words: a transcript can mishear a brand name the script writes right.
 */
export function withScriptSpelling(
  heard: readonly SpokenWord[],
  script: string,
): SpokenWord[] {
  const written = scriptWords(script);
  return written.length === heard.length
    ? heard.map((word, index) => ({ ...word, text: written[index]! }))
    : [...heard];
}

/**
 * When each word of a voice is spoken, from a transcript of it. Empty when
 * the words cannot be timed: the video is then captioned by the provider.
 */
export async function timeSpokenWords(input: {
  audioUrl: string;
  script: string;
  languageCode: string;
}): Promise<SpokenWord[]> {
  const key = getEnv().FAL_KEY;
  if (!key) return [];
  try {
    const response = await fetch(
      `https://fal.run/${TALKING_VIDEO_WORDS_ENDPOINT}`,
      {
        method: "POST",
        headers: {
          authorization: `Key ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          audio_url: input.audioUrl,
          language_code: input.languageCode,
          tag_audio_events: false,
          diarize: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) return [];
    const heard = responseSchema
      .parse(await response.json())
      .words.flatMap(({ text, type, start, end }) =>
        type === "word" && typeof start === "number" && typeof end === "number"
          ? [{ text: text.trim(), start, end }]
          : [],
      );
    return withScriptSpelling(heard, input.script);
  } catch {
    return [];
  }
}
