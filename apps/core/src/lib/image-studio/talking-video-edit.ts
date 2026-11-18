import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CAPTION_FONT_FAMILY, captionFontsDir, runFfmpeg } from "@/lib/ffmpeg";

/**
 * The edit every talking video gets after its presenter clip comes back:
 * pauses cut out, a punch-in on every other sentence so each cut reads as a
 * jump cut, a hook line over the first seconds, and word-by-word captions.
 *
 * All of it is planned from the voice's word timings: the presenter model
 * lip-syncs to that audio, so the clip runs on the same clock.
 */

/** A type alias, not an interface: it is stored in the job's JSON settings. */
export type SpokenWord = {
  text: string;
  start: number;
  end: number;
};

/** A stretch of the presenter clip that is kept, and how far it is punched in. */
export interface EditCut {
  start: number;
  end: number;
  zoom: number;
}

export interface CaptionEvent {
  start: number;
  end: number;
  words: string[];
  /** Index in `words` of the word being spoken. */
  active: number;
}

export interface TalkingVideoEditPlan {
  cuts: EditCut[];
  captions: CaptionEvent[];
  durationSeconds: number;
}

const FRAME = { width: 1080, height: 1920 } as const;
/**
 * TikTok's in-feed layout keeps this part of a 1080 x 1920 video clear of its
 * own caption, buttons and top bar (from TikTok's in-feed ad templates).
 */
export const TIKTOK_SAFE_AREA = {
  left: 120,
  right: 960,
  top: 240,
  bottom: 1260,
} as const;

/** A silence longer than this between two words is cut out. */
const MAX_PAUSE_SECONDS = 0.3;
const LEAD_SECONDS = 0.06;
const TAIL_SECONDS = 0.1;
/** The last word rings out a little longer than a cut inside the video. */
const FINAL_TAIL_SECONDS = 0.25;
const SENTENCE_ZOOMS = [1, 1.2] as const;
const WORDS_PER_CAPTION = 2;
const HOOK_SECONDS = 3;
export const TALKING_VIDEO_HOOK_MAX_LENGTH = 48;

const SENTENCE_END = /[.!?]["')\]]*$/;

/** Plans the cuts and captions for a clip from its spoken words. */
export function planTalkingVideoEdit(
  spoken: readonly SpokenWord[],
  clipSeconds: number,
): TalkingVideoEditPlan | null {
  const words = spoken.filter(
    (word) => word.text.trim() && word.end > word.start,
  );
  if (words.length === 0) return null;

  const cuts: EditCut[] = [];
  const wordCut: number[] = [];
  let sentence = 0;
  let start = Math.max(0, words[0]!.start - LEAD_SECONDS);
  words.forEach((word, index) => {
    wordCut.push(cuts.length);
    const next = words[index + 1];
    const zoom = SENTENCE_ZOOMS[sentence % SENTENCE_ZOOMS.length]!;
    const endsSentence = SENTENCE_END.test(word.text.trim());
    if (!next) {
      cuts.push({
        start,
        end: Math.min(clipSeconds, word.end + FINAL_TAIL_SECONDS),
        zoom,
      });
      return;
    }
    const gap = next.start - word.end;
    if (gap > MAX_PAUSE_SECONDS) {
      cuts.push({ start, end: word.end + TAIL_SECONDS, zoom });
      start = next.start - LEAD_SECONDS;
    } else if (endsSentence) {
      const boundary = word.end + Math.max(0, gap) / 2;
      cuts.push({ start, end: boundary, zoom });
      start = boundary;
    }
    if (endsSentence) sentence += 1;
  });

  const offsets: number[] = [];
  let durationSeconds = 0;
  for (const cut of cuts) {
    offsets.push(durationSeconds);
    durationSeconds += cut.end - cut.start;
  }
  const outTime = (cut: number, sourceTime: number) =>
    offsets[cut]! +
    Math.min(
      cuts[cut]!.end - cuts[cut]!.start,
      Math.max(0, sourceTime - cuts[cut]!.start),
    );

  const captions: CaptionEvent[] = [];
  let index = 0;
  while (index < words.length) {
    const cut = wordCut[index]!;
    const group = [index];
    while (
      group.length < WORDS_PER_CAPTION &&
      wordCut[index + group.length] === cut &&
      !SENTENCE_END.test(words[group.at(-1)!]!.text.trim())
    )
      group.push(index + group.length);
    const after = index + group.length;
    const groupEnd =
      wordCut[after] === cut
        ? outTime(cut, words[after]!.start - LEAD_SECONDS)
        : offsets[cut]! + cuts[cut]!.end - cuts[cut]!.start;
    group.forEach((wordIndex, active) => {
      const next = group[active + 1];
      captions.push({
        start: outTime(cut, words[wordIndex]!.start - LEAD_SECONDS),
        end:
          next === undefined
            ? groupEnd
            : outTime(cut, words[next]!.start - LEAD_SECONDS),
        words: group.map((each) => words[each]!.text.trim()),
        active,
      });
    });
    index = after;
  }
  return {
    cuts,
    captions: captions.filter((caption) => caption.end > caption.start),
    durationSeconds,
  };
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(centiseconds / 360_000)}:${pad(Math.floor(centiseconds / 6000) % 60)}:${pad(Math.floor(centiseconds / 100) % 60)}.${pad(centiseconds % 100)}`;
}

/** Braces and backslashes start ASS override codes; a line break ends the event. */
function assText(text: string): string {
  return text
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const WHITE = "&H00FFFFFF";
const INK = "&H00101010";
/** ASS colours are blue-green-red: this is yellow. */
const SPOKEN = "&H0000E6FF";

/**
 * The captions and the hook line as an ASS subtitle file. Captions sit just
 * above the bottom of TikTok's safe area and wrap inside its sides; the hook
 * line sits at its top.
 */
export function talkingVideoSubtitles(
  plan: TalkingVideoEditPlan,
  hookLine: string | null,
): string {
  const { left, right, top, bottom } = TIKTOK_SAFE_AREA;
  const sideMargin = Math.max(left, FRAME.width - right);
  const style = (
    name: string,
    values: {
      size: number;
      colour: string;
      outlineColour: string;
      borderStyle: 1 | 3;
      outline: number;
      alignment: 2 | 8;
      marginV: number;
    },
  ) =>
    `Style: ${name},${CAPTION_FONT_FAMILY},${values.size},${values.colour},${values.colour},${values.outlineColour},${values.outlineColour},0,0,0,0,100,100,0,0,${values.borderStyle},${values.outline},0,${values.alignment},${sideMargin},${sideMargin},${values.marginV},1`;
  const hook = hookLine ? assText(hookLine) : "";
  const events = [
    ...(hook
      ? [
          `Dialogue: 1,${assTime(0)},${assTime(Math.min(HOOK_SECONDS, plan.durationSeconds))},Hook,,0,0,0,,${hook}`,
        ]
      : []),
    ...plan.captions.map((caption) => {
      const text = caption.words
        .map(assText)
        .map((word, index) =>
          index === caption.active
            ? `{\\c${SPOKEN}&}${word}{\\c${WHITE}&}`
            : word,
        )
        .join(" ");
      return `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Caption,,0,0,0,,${text}`;
    }),
  ];
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${FRAME.width}`,
    `PlayResY: ${FRAME.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Caption", {
      size: 100,
      colour: WHITE,
      outlineColour: INK,
      borderStyle: 1,
      outline: 8,
      alignment: 2,
      marginV: FRAME.height - bottom + 30,
    }),
    style("Hook", {
      size: 58,
      colour: INK,
      outlineColour: WHITE,
      borderStyle: 3,
      outline: 16,
      alignment: 8,
      marginV: top + 50,
    }),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/** A path as a value inside an ffmpeg filter argument. */
function filterPath(value: string): string {
  return value.replace(/[\\:',[\];]/g, (character) => `\\${character}`);
}

/**
 * ffmpeg arguments that cut `clip` to the plan and burn `subtitles` in. Each
 * cut is its own seeked input, so the cuts decode one after another and
 * nothing waits in memory.
 */
export function talkingVideoEditArgs(input: {
  plan: TalkingVideoEditPlan;
  clip: string;
  subtitles: string;
  fontsDir: string;
  output: string;
}): string[] {
  const { cuts } = input.plan;
  const inputs = cuts.flatMap((cut) => [
    "-ss",
    cut.start.toFixed(3),
    "-t",
    (cut.end - cut.start).toFixed(3),
    "-i",
    input.clip,
  ]);
  const graph = [
    ...cuts.map((cut, index) => {
      const width = 2 * Math.round(FRAME.width / cut.zoom / 2);
      const height = 2 * Math.round(FRAME.height / cut.zoom / 2);
      // Punched in from the top, where the presenter's face is.
      return `[${index}:v]scale=${FRAME.width}:${FRAME.height},crop=${width}:${height}:(iw-ow)/2:0,scale=${FRAME.width}:${FRAME.height},setsar=1,fps=30[v${index}]`;
    }),
    `${cuts.map((_, index) => `[v${index}][${index}:a]`).join("")}concat=n=${cuts.length}:v=1:a=1[cut][audio]`,
    `[cut]ass=${filterPath(input.subtitles)}:fontsdir=${filterPath(input.fontsDir)}[video]`,
  ].join(";");
  return [
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[video]",
    "-map",
    "[audio]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    input.output,
  ];
}

/** Under the settlement lease, with room for the download and the upload. */
const EDIT_TIMEOUT_MS = 110_000;

/** The edited video, or null when the clip has no word timings to plan from. */
export async function editTalkingVideo(input: {
  clip: Uint8Array;
  words: readonly SpokenWord[];
  clipSeconds: number;
  hookLine: string | null;
}): Promise<{ bytes: Uint8Array; durationSeconds: number } | null> {
  const plan = planTalkingVideoEdit(input.words, input.clipSeconds);
  if (!plan) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "talking-video-"));
  try {
    await writeFile(path.join(dir, "clip.mp4"), input.clip);
    await writeFile(
      path.join(dir, "captions.ass"),
      talkingVideoSubtitles(plan, input.hookLine),
    );
    await runFfmpeg(
      talkingVideoEditArgs({
        plan,
        clip: "clip.mp4",
        subtitles: "captions.ass",
        fontsDir: await captionFontsDir(),
        output: "edited.mp4",
      }),
      { cwd: dir, timeoutMs: EDIT_TIMEOUT_MS },
    );
    return {
      bytes: await readFile(path.join(dir, "edited.mp4")),
      durationSeconds: plan.durationSeconds,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
