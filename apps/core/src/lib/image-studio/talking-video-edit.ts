import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CAPTION_FONT_FAMILY, captionFontsDir, runFfmpeg } from "@/lib/ffmpeg";

/**
 * The edit every talking video gets after its presenter clip comes back:
 * pauses cut out, a punch-in on every other sentence so each cut reads as a
 * jump cut, a hook line over the first seconds, and word-by-word captions.
 * With a screenshot of the brand's site, the middle sentences show it: the
 * presenter cut out over the page, or the page alone. With the brand's logo,
 * the video ends on a card.
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

/**
 * What a cut shows: the presenter as filmed, the presenter cut out over the
 * brand's page, or the page alone while the voice goes on.
 */
export type EditShot = "camera" | "over-page" | "page";

/** A stretch of the presenter clip that is kept, and how it is shown. */
export interface EditCut {
  start: number;
  end: number;
  /** How far a camera shot is punched in. */
  zoom: number;
  shot: EditShot;
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
  /** The cuts' length together, before the end card. */
  speechSeconds: number;
  durationSeconds: number;
}

/** The first sentence is the hook and the last the next step: both to camera. */
function sentenceShot(sentence: number, sentences: number): EditShot {
  if (sentence === 0) return "camera";
  if (sentences >= 3 && sentence === sentences - 1) return "camera";
  return sentence % 2 === 1 ? "over-page" : "page";
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
export const END_CARD_SECONDS = 1.7;
export const TALKING_VIDEO_HOOK_MAX_LENGTH = 48;

const SENTENCE_END = /[.!?]["')\]]*$/;

/** Plans the cuts and captions for a clip from its spoken words. */
export function planTalkingVideoEdit(
  spoken: readonly SpokenWord[],
  clipSeconds: number,
  options: { siteShots?: boolean; endCard?: boolean } = {},
): TalkingVideoEditPlan | null {
  const words = spoken.filter(
    (word) => word.text.trim() && word.end > word.start,
  );
  if (words.length === 0) return null;
  const sentences =
    words.filter((word) => SENTENCE_END.test(word.text.trim())).length +
    (SENTENCE_END.test(words.at(-1)!.text.trim()) ? 0 : 1);

  const cuts: EditCut[] = [];
  const wordCut: number[] = [];
  let sentence = 0;
  let start = Math.max(0, words[0]!.start - LEAD_SECONDS);
  words.forEach((word, index) => {
    wordCut.push(cuts.length);
    const next = words[index + 1];
    const look = {
      zoom: SENTENCE_ZOOMS[sentence % SENTENCE_ZOOMS.length]!,
      shot: options.siteShots
        ? sentenceShot(sentence, sentences)
        : ("camera" as const),
    };
    const endsSentence = SENTENCE_END.test(word.text.trim());
    if (!next) {
      cuts.push({
        start,
        end: Math.min(clipSeconds, word.end + FINAL_TAIL_SECONDS),
        ...look,
      });
      return;
    }
    const gap = next.start - word.end;
    if (gap > MAX_PAUSE_SECONDS) {
      cuts.push({ start, end: word.end + TAIL_SECONDS, ...look });
      start = next.start - LEAD_SECONDS;
    } else if (endsSentence) {
      const boundary = word.end + Math.max(0, gap) / 2;
      cuts.push({ start, end: boundary, ...look });
      start = boundary;
    }
    if (endsSentence) sentence += 1;
  });

  const offsets: number[] = [];
  let speechSeconds = 0;
  for (const cut of cuts) {
    offsets.push(speechSeconds);
    speechSeconds += cut.end - cut.start;
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
    speechSeconds,
    durationSeconds: speechSeconds + (options.endCard ? END_CARD_SECONDS : 0),
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

/** Where the logo sits on the end card, and the line under it. */
const END_CARD_LOGO_CENTRE = 800;
const END_CARD_TEXT_TOP = 1010;
/** The logo is fitted into this box before it is placed. */
export const END_CARD_LOGO_BOX = { width: 640, height: 320 } as const;
/** The presenter over a page: scaled down and stood on the bottom edge. */
const OVER_PAGE_PRESENTER = { width: 800, height: 1422 } as const;
/** Pixels a second the page drifts behind the presenter, and pans alone. */
const OVER_PAGE_DRIFT = 24;
const PAGE_PAN = 70;
/** A page shown alone starts this far down, past what the presenter stood on. */
const PAGE_PAN_FROM = 1000;

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
  /** The line under the logo on the end card, and whether the card is dark. */
  endCard: { text: string; dark: boolean } | null = null,
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
          `Dialogue: 1,${assTime(0)},${assTime(Math.min(HOOK_SECONDS, plan.speechSeconds))},Hook,,0,0,0,,${hook}`,
        ]
      : []),
    ...(endCard && assText(endCard.text)
      ? [
          `Dialogue: 1,${assTime(plan.speechSeconds)},${assTime(plan.durationSeconds)},Card,,0,0,0,,${assText(endCard.text)}`,
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
    style("Card", {
      size: 64,
      colour: endCard?.dark === false ? INK : WHITE,
      outlineColour: endCard?.dark === false ? WHITE : INK,
      borderStyle: 1,
      outline: 0,
      alignment: 8,
      marginV: END_CARD_TEXT_TOP,
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

export interface TalkingVideoEditFiles {
  /** The presenter clip, with its sound. */
  clip: string;
  subtitles: string;
  fontsDir: string;
  output: string;
  /** For the shots that show the brand's site. */
  site?: {
    /** The clip's matte: white where the presenter is. Same frames as `clip`. */
    alpha: string;
    /** A screenshot of the page, 1080 wide and at least 1920 high. */
    page: string;
  };
  /** Present when the video ends on a card. */
  endCard?: { logo: string; dark: boolean };
}

/**
 * ffmpeg arguments that cut the clip to the plan and burn the subtitles in.
 * Each cut is its own seeked input, so the cuts decode one after another and
 * nothing waits in memory.
 */
export function talkingVideoEditArgs(
  plan: TalkingVideoEditPlan,
  files: TalkingVideoEditFiles,
): string[] {
  const inputs: string[] = [];
  let inputCount = 0;
  const addInput = (...args: string[]) => {
    inputs.push(...args);
    return inputCount++;
  };
  const size = `${FRAME.width}:${FRAME.height}`;
  const sound =
    "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const graph: string[] = [];
  const parts: string[] = [];

  plan.cuts.forEach((cut, index) => {
    const seconds = (cut.end - cut.start).toFixed(3);
    const seek = ["-ss", cut.start.toFixed(3), "-t", seconds];
    const still = ["-loop", "1", "-framerate", "30", "-t", seconds];
    const clip = addInput(...seek, "-i", files.clip);
    const shot = files.site ? cut.shot : "camera";
    if (shot === "camera") {
      const width = 2 * Math.round(FRAME.width / cut.zoom / 2);
      const height = 2 * Math.round(FRAME.height / cut.zoom / 2);
      // Punched in from the top, where the presenter's face is.
      graph.push(
        `[${clip}:v]scale=${size},crop=${width}:${height}:(iw-ow)/2:0,scale=${size},setsar=1,fps=30[v${index}]`,
      );
    } else if (shot === "page") {
      const page = addInput(...still, "-i", files.site!.page);
      graph.push(
        `[${page}:v]crop=${size}:0:'min(ih-oh,${PAGE_PAN_FROM}+${PAGE_PAN}*t)',setsar=1,fps=30[v${index}]`,
      );
    } else {
      const alpha = addInput(...seek, "-i", files.site!.alpha);
      const page = addInput(...still, "-i", files.site!.page);
      const person = `${OVER_PAGE_PRESENTER.width}:${OVER_PAGE_PRESENTER.height}`;
      graph.push(
        `[${clip}:v]scale=${person}[p${index}]`,
        `[${alpha}:v]scale=${person},format=gray[m${index}]`,
        `[p${index}][m${index}]alphamerge[c${index}]`,
        `[${page}:v]crop=${size}:0:'min(ih-oh,${OVER_PAGE_DRIFT}*t)'[b${index}]`,
        `[b${index}][c${index}]overlay=(W-w)/2:H-h:shortest=1,setsar=1,fps=30[v${index}]`,
      );
    }
    graph.push(`[${clip}:a]${sound}[a${index}]`);
    parts.push(`[v${index}][a${index}]`);
  });

  if (files.endCard) {
    const seconds = END_CARD_SECONDS.toFixed(3);
    const colour = files.endCard.dark ? "0x101010" : "0xFFFFFF";
    const card = addInput(
      ...["-f", "lavfi", "-t", seconds],
      ...["-i", `color=c=${colour}:s=${FRAME.width}x${FRAME.height}:r=30`],
    );
    const logo = addInput(
      ...["-loop", "1", "-framerate", "30", "-t", seconds],
      ...["-i", files.endCard.logo],
    );
    const silence = addInput(
      ...["-f", "lavfi", "-t", seconds],
      ...["-i", "anullsrc=r=44100:cl=stereo"],
    );
    graph.push(
      `[${card}:v][${logo}:v]overlay=(W-w)/2:${END_CARD_LOGO_CENTRE}-h/2:shortest=1,setsar=1,fps=30[vcard]`,
      `[${silence}:a]${sound}[acard]`,
    );
    parts.push("[vcard][acard]");
  }

  graph.push(
    `${parts.join("")}concat=n=${parts.length}:v=1:a=1[cut][audio]`,
    `[cut]ass=${filterPath(files.subtitles)}:fontsdir=${filterPath(files.fontsDir)}[video]`,
  );
  return [
    ...inputs,
    "-filter_complex",
    graph.join(";"),
    ...["-map", "[video]", "-map", "[audio]"],
    ...["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"],
    ...["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"],
    ...["-movflags", "+faststart"],
    files.output,
  ];
}

/** Under the settlement lease, with room for the download and the upload. */
const EDIT_TIMEOUT_MS = 110_000;

export interface TalkingVideoEditInput {
  clip: Uint8Array;
  words: readonly SpokenWord[];
  clipSeconds: number;
  hookLine: string | null;
  /** The clip's matte and a screenshot of the brand's page, for site shots. */
  site?: { alpha: Uint8Array; page: Uint8Array };
  /** A PNG of the logo fitted to `END_CARD_LOGO_BOX`, and the line under it. */
  endCard?: { logo: Uint8Array; dark: boolean; text: string };
}

/** The edited video, or null when the clip has no word timings to plan from. */
export async function editTalkingVideo(
  input: TalkingVideoEditInput,
): Promise<{ bytes: Uint8Array; durationSeconds: number } | null> {
  const plan = planTalkingVideoEdit(input.words, input.clipSeconds, {
    siteShots: Boolean(input.site),
    endCard: Boolean(input.endCard),
  });
  if (!plan) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "talking-video-"));
  try {
    await Promise.all([
      writeFile(path.join(dir, "clip.mp4"), input.clip),
      writeFile(
        path.join(dir, "captions.ass"),
        talkingVideoSubtitles(plan, input.hookLine, input.endCard ?? null),
      ),
      ...(input.site
        ? [
            writeFile(path.join(dir, "alpha.mp4"), input.site.alpha),
            writeFile(path.join(dir, "page.jpg"), input.site.page),
          ]
        : []),
      ...(input.endCard
        ? [writeFile(path.join(dir, "logo.png"), input.endCard.logo)]
        : []),
    ]);
    await runFfmpeg(
      talkingVideoEditArgs(plan, {
        clip: "clip.mp4",
        subtitles: "captions.ass",
        fontsDir: await captionFontsDir(),
        output: "edited.mp4",
        ...(input.site
          ? { site: { alpha: "alpha.mp4", page: "page.jpg" } }
          : {}),
        ...(input.endCard
          ? { endCard: { logo: "logo.png", dark: input.endCard.dark } }
          : {}),
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
