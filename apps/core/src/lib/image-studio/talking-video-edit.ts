import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SHORT_VIDEO_TEXT_FORMATS,
  type ShortVideoFormat,
  type VideoShape,
} from "@sokosumi/utils";

import { CAPTION_FONT_FAMILY, captionFontsDir, runFfmpeg } from "@/lib/ffmpeg";

import { renderVideoCards, type VideoCardBrand } from "./video-cards";
import { VIDEO_LAYOUTS, type VideoLayout } from "./video-layout";

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
 *
 * A short has no presenter. The same plan times its shots (the brand's
 * pictures, its site, a text card) per sentence under the voice, or under the
 * music alone when its words are only on screen (`planShortVideo`).
 */

/** A type alias, not an interface: it is stored in the job's JSON settings. */
export type SpokenWord = {
  text: string;
  start: number;
  end: number;
};

/**
 * What a cut shows: the presenter as filmed, the presenter cut out over the
 * brand's page, the page alone, a B-roll clip, one of a short's pictures, or
 * a plain card when a short has neither pictures nor a page.
 */
export type EditShot =
  | "camera"
  | "over-page"
  | "page"
  | "broll"
  | "picture"
  | "card";

/** A stretch of the presenter clip that is kept, and how it is shown. */
export interface EditCut {
  start: number;
  end: number;
  /** How far a camera or page shot is punched in; under 1, a page is inset. */
  zoom: number;
  shot: EditShot;
  /** The picture a short's picture shot shows. */
  picture?: number;
  /** How far down the page a short's page shot starts, in pixels. */
  pageFrom?: number;
}

/** Words a short shows one sentence at a time instead of captions. */
export interface ScreenLine {
  start: number;
  end: number;
  text: string;
  style: "Label" | "Number";
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
  /** The sentence each cut belongs to, by index. */
  cutSentence: number[];
  captions: CaptionEvent[];
  lines: ScreenLine[];
  /** Captions sit on a box: a short's shots include pages full of their own text. */
  captionBox: boolean;
  /** How long the hook line shows. */
  hookSeconds: number;
  /** The cuts' length together, before the end card. */
  speechSeconds: number;
  durationSeconds: number;
  /** Where a launch's date card shows: over the sentence that says when. */
  cardSpan?: { start: number; end: number; text: string };
}

/** The first sentence is the hook and the last the next step: both to camera. */
function sentenceShot(sentence: number, sentences: number): EditShot {
  if (sentence === 0) return "camera";
  if (sentences >= 3 && sentence === sentences - 1) return "camera";
  return sentence % 2 === 1 ? "over-page" : "page";
}

export const TIKTOK_SAFE_AREA = VIDEO_LAYOUTS["9:16"].safe;
/** Every presenter clip is made, and its photo framed, at this size. */
const PRESENTER_CLIP = { width: 1080, height: 1920 } as const;

/** A silence longer than this between two words is cut out. */
const MAX_PAUSE_SECONDS = 0.3;
const LEAD_SECONDS = 0.06;
const TAIL_SECONDS = 0.1;
/** The last word rings out a little longer than a cut inside the video. */
const FINAL_TAIL_SECONDS = 0.25;
const SENTENCE_ZOOMS = [1, 1.2] as const;
const WORDS_PER_CAPTION = 2;
const HOOK_SECONDS = 3;
/** How long the presenter is seen before the B-roll, and the clip's bounds. */
const BROLL_LEAD_SECONDS = 1;
const BROLL_MIN_SECONDS = 0.8;
const BROLL_MAX_SECONDS = 3;
/** The music bed under the voice, as a share of full volume. */
const MUSIC_VOLUME = 0.3;
const MUSIC_FADE_SECONDS = 0.6;
const LOUDNESS_LUFS = -14;
export const END_CARD_SECONDS = 1.7;
export const TALKING_VIDEO_HOOK_MAX_LENGTH = 48;

const SENTENCE_END = /[.!?]["')\]]*$/;

/**
 * Cuts the B-roll into the hook: the presenter opens to camera for a second,
 * then the clip plays under their voice for up to three, and they come back
 * if the first cut runs on. A first cut too short for that is left alone.
 */
function showBrollInHook(
  cuts: EditCut[],
  cutSentence: number[],
  words: readonly SpokenWord[],
  wordCut: number[],
): void {
  const first = cuts[0]!;
  if (first.end - first.start < BROLL_LEAD_SECONDS + BROLL_MIN_SECONDS) return;
  const from = first.start + BROLL_LEAD_SECONDS;
  const wanted = from + BROLL_MAX_SECONDS;
  const until = first.end - wanted < BROLL_MIN_SECONDS ? first.end : wanted;
  const pieces: EditCut[] = [
    { ...first, end: from },
    { ...first, start: from, end: until, shot: "broll" },
    ...(until < first.end ? [{ ...first, start: until }] : []),
  ];
  cuts.splice(0, 1, ...pieces);
  cutSentence.splice(0, 1, ...pieces.map(() => 0));
  wordCut.forEach((cut, index) => {
    if (cut > 0) {
      wordCut[index] = cut + pieces.length - 1;
      return;
    }
    const at = words[index]!.start;
    wordCut[index] = at < from ? 0 : at < until ? 1 : 2;
  });
}

/**
 * Whether the opening sentence is long enough to show B-roll under it. A
 * clip the edit would leave out is not made, so it is not paid for.
 */
export function hookTakesBroll(
  spoken: readonly SpokenWord[],
  clipSeconds: number,
): boolean {
  return (
    planTalkingVideoEdit(spoken, clipSeconds, { broll: true })?.cuts.some(
      (cut) => cut.shot === "broll",
    ) ?? false
  );
}

/** Plans the cuts and captions for a clip from its spoken words. */
export function planTalkingVideoEdit(
  spoken: readonly SpokenWord[],
  clipSeconds: number,
  options: { siteShots?: boolean; endCard?: boolean; broll?: boolean } = {},
): TalkingVideoEditPlan | null {
  const words = spoken.filter(
    (word) => word.text.trim() && word.end > word.start,
  );
  if (words.length === 0) return null;
  const sentences =
    words.filter((word) => SENTENCE_END.test(word.text.trim())).length +
    (SENTENCE_END.test(words.at(-1)!.text.trim()) ? 0 : 1);

  const cuts: EditCut[] = [];
  const cutSentence: number[] = [];
  const wordCut: number[] = [];
  let sentence = 0;
  const keep = (cut: EditCut) => {
    cuts.push(cut);
    cutSentence.push(sentence);
  };
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
      keep({
        start,
        end: Math.min(clipSeconds, word.end + FINAL_TAIL_SECONDS),
        ...look,
      });
      return;
    }
    const gap = next.start - word.end;
    if (gap > MAX_PAUSE_SECONDS) {
      keep({ start, end: word.end + TAIL_SECONDS, ...look });
      start = next.start - LEAD_SECONDS;
    } else if (endsSentence) {
      const boundary = word.end + Math.max(0, gap) / 2;
      keep({ start, end: boundary, ...look });
      start = boundary;
    }
    if (endsSentence) sentence += 1;
  });

  if (options.broll) showBrollInHook(cuts, cutSentence, words, wordCut);

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
    cutSentence,
    captions: captions.filter((caption) => caption.end > caption.start),
    lines: [],
    captionBox: false,
    hookSeconds: Math.min(HOOK_SECONDS, speechSeconds),
    speechSeconds,
    durationSeconds: speechSeconds + (options.endCard ? END_CARD_SECONDS : 0),
  };
}

/** A short cuts to a new shot at least this often, inside a long sentence. */
const SHORT_SHOT_MAX_SECONDS = 2.6;
/** How far down the page each of a short's page shots starts after the last. */
const SHORT_PAGE_STEP = 640;
/** How many points a list numbers. */
const TOP_THREE_POINTS = 3;
/**
 * A website tour shows every other page shot inset, like a screen, over a
 * blurred copy of itself: a punch-in cut the page's text at its sides.
 */
const SHORT_TOUR_INSET = 0.84;

export interface ShortVideoPlanOptions {
  format: ShortVideoFormat;
  /** How many of the brand's pictures the short can show. */
  pictures: number;
  /** A screenshot of the brand's site can be shown. */
  page: boolean;
  endCard: boolean;
}

/**
 * What a short's cut shows. Each format leans on its own source and falls
 * back to the next one the short has: pictures, then the page, then a card.
 */
function shortShot(
  options: ShortVideoPlanOptions,
  index: number,
  sentence: number,
  sentences: number,
): Pick<EditCut, "shot" | "zoom" | "picture" | "pageFrom"> {
  const page = (step: number, zoom = 1) =>
    ({ shot: "page", zoom, pageFrom: step * SHORT_PAGE_STEP }) as const;
  const picture = (step: number) =>
    options.pictures > 0
      ? ({
          shot: "picture",
          zoom: 1,
          picture: step % options.pictures,
        } as const)
      : options.page
        ? page(step)
        : ({ shot: "card", zoom: 1 } as const);
  switch (options.format) {
    case "site_tour":
      return options.page
        ? page(index, index % 2 === 1 ? SHORT_TOUR_INSET : 1)
        : picture(index);
    case "top_three":
      return options.page && sentences >= 3 && sentence === sentences - 1
        ? page(0)
        : picture(index);
    case "slideshow":
    case "launch":
      return picture(index);
    case "voiceover":
      return options.page && options.pictures > 0 && index % 2 === 1
        ? page((index - 1) / 2)
        : picture(options.page ? index / 2 : index);
  }
}

/** The text of each sentence, in the order the plan counts them. */
function sentenceTexts(words: readonly SpokenWord[]): string[] {
  const texts: string[][] = [[]];
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    texts.at(-1)!.push(text);
    if (SENTENCE_END.test(text)) texts.push([]);
  }
  return texts
    .filter((sentence) => sentence.length > 0)
    .map((sentence) => sentence.join(" "));
}

/**
 * Plans a short without a presenter: the voice (or, for words shown on
 * screen, their reading time) is cut like a presenter clip, and each cut
 * shows one of the brand's pictures or its site. A long sentence
 * is split into several shots, so the picture keeps changing.
 */
export function planShortVideo(
  spoken: readonly SpokenWord[],
  clipSeconds: number,
  options: ShortVideoPlanOptions,
): TalkingVideoEditPlan | null {
  const base = planTalkingVideoEdit(spoken, clipSeconds, {
    endCard: options.endCard,
  });
  if (!base) return null;
  const onScreen = SHORT_VIDEO_TEXT_FORMATS.includes(options.format);
  const cuts: EditCut[] = [];
  const cutSentence: number[] = [];
  base.cuts.forEach((cut, index) => {
    const length = cut.end - cut.start;
    const pieces = Math.max(1, Math.ceil(length / SHORT_SHOT_MAX_SECONDS));
    for (let piece = 0; piece < pieces; piece += 1) {
      cuts.push({
        ...cut,
        start: cut.start + (piece * length) / pieces,
        end: cut.start + ((piece + 1) * length) / pieces,
      });
      cutSentence.push(base.cutSentence[index]!);
    }
  });
  const sentences = (cutSentence.at(-1) ?? 0) + 1;
  const shots = cuts.map((cut, index) => ({
    start: cut.start,
    end: cut.end,
    ...shortShot(options, index, cutSentence[index]!, sentences),
  }));

  const spans: { start: number; end: number }[] = [];
  let at = 0;
  shots.forEach((cut, index) => {
    const sentence = cutSentence[index]!;
    const end = at + cut.end - cut.start;
    spans[sentence] = { start: spans[sentence]?.start ?? at, end };
    at = end;
  });
  const texts = sentenceTexts(spoken);
  const lines: ScreenLine[] = [];
  if (onScreen) {
    spans.forEach((span, sentence) => {
      const text = texts[sentence];
      if (span && text) lines.push({ ...span, text, style: "Label" });
    });
  }
  // The first sentence names the list, the next three are its points, and
  // what follows says what to do next.
  if (options.format === "top_three") {
    const last = Math.min(TOP_THREE_POINTS, sentences - 2);
    for (let sentence = 1; sentence <= last; sentence += 1) {
      const span = spans[sentence];
      if (span)
        lines.push({ ...span, text: String(sentence), style: "Number" });
    }
  }
  // The second sentence says when, and the hook keeps the first to itself;
  // a launch told in one sentence shows its date over that sentence.
  const dated = sentences > 1 ? 1 : 0;
  const dateSpan = options.format === "launch" ? spans[dated] : undefined;
  const dateText = texts[dated];
  return {
    ...base,
    cuts: shots,
    cutSentence,
    captions: onScreen ? [] : base.captions,
    lines,
    captionBox: true,
    ...(dateSpan && dateText
      ? { cardSpan: { ...dateSpan, text: dateText } }
      : {}),
    // A list's hook names it; a launch's makes way for its date card.
    hookSeconds:
      (options.format === "top_three" || options.format === "launch") &&
      sentences > 1
        ? (spans[0]?.end ?? base.hookSeconds)
        : base.hookSeconds,
  };
}

/** Seconds a word shown on screen stays, by its length, and a sentence's hold. */
const READ_WORD_SECONDS = 0.22;
const READ_CHARACTER_SECONDS = 0.035;
const READ_SENTENCE_HOLD_SECONDS = 0.5;

/**
 * Times the words of a short that is read, not spoken: as long as a person
 * takes to read them, with a hold after each sentence. A line without an end
 * mark is its own sentence.
 */
export function readingTimings(script: string): SpokenWord[] {
  const words = script
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(/\s+/);
      const last = parts.length - 1;
      if (!SENTENCE_END.test(parts[last]!)) parts[last] = `${parts[last]}.`;
      return parts;
    });
  let at = 0;
  return words.map((text) => {
    const start = at;
    at +=
      READ_WORD_SECONDS +
      READ_CHARACTER_SECONDS * text.length +
      (SENTENCE_END.test(text) ? READ_SENTENCE_HOLD_SECONDS : 0);
    return { text, start, end: at };
  });
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

/** The logo is fitted into this box before it is placed. */
export const END_CARD_LOGO_BOX = { width: 640, height: 320 } as const;
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
 * above the bottom of the layout's safe area and wrap inside its sides; the
 * hook line sits at its top.
 */
export function talkingVideoSubtitles(
  plan: TalkingVideoEditPlan,
  hookLine: string | null,
  /** The line under the logo on the end card, and whether the card is dark. */
  endCard: { text: string; dark: boolean } | null = null,
  layout: VideoLayout = VIDEO_LAYOUTS["9:16"],
): string {
  const { frame, text: sizes } = layout;
  const { left, right, top, bottom } = layout.safe;
  const sideMargin = Math.max(left, frame.width - right);
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
    ...(hook && plan.hookSeconds > 0
      ? [
          `Dialogue: 1,${assTime(0)},${assTime(plan.hookSeconds)},Hook,,0,0,0,,${hook}`,
        ]
      : []),
    ...(endCard && assText(endCard.text)
      ? [
          `Dialogue: 1,${assTime(plan.speechSeconds)},${assTime(plan.durationSeconds)},Card,,0,0,0,,${assText(endCard.text)}`,
        ]
      : []),
    ...plan.lines.flatMap((line) =>
      assText(line.text)
        ? [
            `Dialogue: 1,${assTime(line.start)},${assTime(line.end)},${line.style},,0,0,0,,${assText(line.text)}`,
          ]
        : [],
    ),
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
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Caption", {
      size: sizes.caption,
      colour: WHITE,
      outlineColour: INK,
      ...(plan.captionBox
        ? { borderStyle: 3, outline: 14 }
        : { borderStyle: 1, outline: 8 }),
      alignment: 2,
      marginV: frame.height - bottom + 30,
    }),
    style("Hook", {
      size: sizes.hook,
      colour: INK,
      outlineColour: WHITE,
      borderStyle: 3,
      outline: 16,
      alignment: 8,
      marginV: top + 50,
    }),
    // A short's own words: a label over a picture, or a list point's number.
    style("Label", {
      size: sizes.label,
      colour: INK,
      outlineColour: WHITE,
      borderStyle: 3,
      outline: 22,
      alignment: 8,
      marginV: top + 50,
    }),
    style("Number", {
      size: sizes.number,
      colour: SPOKEN,
      outlineColour: INK,
      borderStyle: 1,
      outline: 10,
      alignment: 8,
      marginV: top + 20,
    }),
    style("Card", {
      size: sizes.card,
      colour: endCard?.dark === false ? INK : WHITE,
      outlineColour: endCard?.dark === false ? WHITE : INK,
      borderStyle: 1,
      outline: 0,
      alignment: 8,
      marginV: layout.endCard.textTop,
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
  /** The presenter clip, with its sound. A short has none. */
  clip?: string;
  /** A short's voice. A short whose words are only on screen has none. */
  voice?: string;
  subtitles: string;
  fontsDir: string;
  output: string;
  /** A screenshot of the brand's page, at least the frame's width and height. */
  page?: string;
  /** The clip's matte: white where the presenter is. Same frames as `clip`. */
  alpha?: string;
  /** A short's pictures, each the size of the frame. */
  pictures?: string[];
  /** The colour of a card with no picture behind it, as `0xRRGGBB`. */
  cardColour?: string;
  /** Present when the video ends on a card. */
  endCard?: { logo: string; dark: boolean };
  /** A clip shown in the hook. */
  broll?: string;
  /** An instrumental bed, looped under the whole video. */
  music?: string;
  /** Designed stills over the cut, each a transparent PNG the frame's size. */
  cards?: { png: string; start: number; end: number }[];
}

/** A card fades in and out over this long. */
const CARD_FADE_SECONDS = 0.25;

/** Music under a voice is a bed; without one, it carries the short. */
const MUSIC_UNDER_WORDS_VOLUME = 0.9;

/**
 * The shot a cut can show with the files there are. A presenter video falls
 * back to its camera; a short to its pictures, its page, then a card.
 */
function availableShot(cut: EditCut, files: TalkingVideoEditFiles): EditShot {
  const has: Record<EditShot, boolean> = {
    camera: Boolean(files.clip),
    "over-page": Boolean(files.clip && files.alpha && files.page),
    page: Boolean(files.page),
    broll: Boolean(files.broll),
    picture: Boolean(files.pictures?.length),
    card: true,
  };
  if (has[cut.shot]) return cut.shot;
  if (files.clip) return "camera";
  return (["picture", "page", "card"] as const).find((shot) => has[shot])!;
}

/**
 * ffmpeg arguments that cut the clip to the plan and burn the subtitles in.
 * Each cut is its own seeked input, so the cuts decode one after another and
 * nothing waits in memory.
 */
export function talkingVideoEditArgs(
  plan: TalkingVideoEditPlan,
  files: TalkingVideoEditFiles,
  layout: VideoLayout = VIDEO_LAYOUTS["9:16"],
): string[] {
  const { frame, overPage, picturePan } = layout;
  const inputs: string[] = [];
  let inputCount = 0;
  const addInput = (...args: string[]) => {
    inputs.push(...args);
    return inputCount++;
  };
  const size = `${frame.width}:${frame.height}`;
  const sound =
    "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const graph: string[] = [];
  const parts: string[] = [];
  const pictures = files.pictures ?? [];

  plan.cuts.forEach((cut, index) => {
    const seconds = (cut.end - cut.start).toFixed(3);
    const seek = ["-ss", cut.start.toFixed(3), "-t", seconds];
    const still = ["-loop", "1", "-framerate", "30", "-t", seconds];
    const spoken = files.clip ?? files.voice;
    const audio = spoken
      ? addInput(...seek, "-i", spoken)
      : addInput(
          ...["-f", "lavfi", "-t", seconds],
          ...["-i", "anullsrc=r=44100:cl=stereo"],
        );
    const clip = audio;
    const shot = availableShot(cut, files);
    if (shot === "camera" && layout.camera === "pillar") {
      const width = 2 * Math.round(PRESENTER_CLIP.width / cut.zoom / 2);
      const height = 2 * Math.round(PRESENTER_CLIP.height / cut.zoom / 2);
      graph.push(
        `[${clip}:v]scale=${PRESENTER_CLIP.width}:${PRESENTER_CLIP.height},crop=${width}:${height}:(iw-ow)/2:0,split[ca${index}][cf${index}]`,
        `[ca${index}]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=24,drawbox=c=black@0.25:t=fill,setsar=1[cb${index}]`,
        `[cf${index}]scale=-2:${frame.height}[cp${index}]`,
        `[cb${index}][cp${index}]overlay=(W-w)/2:0,setsar=1,fps=30[v${index}]`,
      );
    } else if (shot === "camera") {
      const width = 2 * Math.round(frame.width / cut.zoom / 2);
      const height = 2 * Math.round(frame.height / cut.zoom / 2);
      // Punched in from the layout's top, where the presenter's face is.
      graph.push(
        `[${clip}:v]scale=${PRESENTER_CLIP.width}:${PRESENTER_CLIP.height},crop=${width}:${height}:(iw-ow)/2:${layout.cameraTop},scale=${size},setsar=1,fps=30[v${index}]`,
      );
    } else if (shot === "broll") {
      const broll = addInput(
        ...(files.clip ? [] : ["-stream_loop", "-1"]),
        ...["-t", seconds, "-i", files.broll!],
      );
      // A vertical clip in a widescreen frame is shown whole, like the presenter.
      graph.push(
        ...(layout.camera === "pillar"
          ? [
              `[${broll}:v]split[ra${index}][rf${index}]`,
              `[ra${index}]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=24,drawbox=c=black@0.25:t=fill,setsar=1[rb${index}]`,
              `[rf${index}]scale=-2:${frame.height}[rp${index}]`,
              `[rb${index}][rp${index}]overlay=(W-w)/2:0,setsar=1,fps=30[v${index}]`,
            ]
          : [
              `[${broll}:v]scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1,fps=30[v${index}]`,
            ]),
      );
    } else if (shot === "picture") {
      const picture = addInput(
        ...still,
        "-i",
        pictures[(cut.picture ?? index) % pictures.length]!,
      );
      // Every other picture pans up instead of down.
      const along = index % 2 === 0 ? `t/${seconds}` : `(1-t/${seconds})`;
      graph.push(
        `[${picture}:v]scale=${picturePan.width}:${picturePan.height},crop=${size}:(iw-ow)/2:'(ih-oh)*${along}',setsar=1,fps=30[v${index}]`,
      );
    } else if (shot === "card") {
      const card = addInput(
        ...["-f", "lavfi", "-t", seconds],
        ...[
          "-i",
          `color=c=${files.cardColour ?? "0x101010"}:s=${frame.width}x${frame.height}:r=30`,
        ],
      );
      graph.push(`[${card}:v]setsar=1,fps=30[v${index}]`);
    } else if (shot === "page" && cut.zoom < 1) {
      const page = addInput(...still, "-i", files.page!);
      const width = 2 * Math.round((frame.width * cut.zoom) / 2);
      const height = 2 * Math.round((frame.height * cut.zoom) / 2);
      graph.push(
        `[${page}:v]split[pa${index}][pf${index}]`,
        `[pa${index}]crop=${size}:0:${cut.pageFrom ?? PAGE_PAN_FROM},boxblur=24,drawbox=c=black@0.35:t=fill,setsar=1[pb${index}]`,
        `[pf${index}]scale=${width}:-2,crop=${width}:${height}:0:'min(ih-oh,${Math.round((cut.pageFrom ?? PAGE_PAN_FROM) * cut.zoom)}+${PAGE_PAN}*t)'[pt${index}]`,
        `[pb${index}][pt${index}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30[v${index}]`,
      );
    } else if (shot === "page") {
      const page = addInput(...still, "-i", files.page!);
      const width = 2 * Math.round(frame.width / cut.zoom / 2);
      const height = 2 * Math.round(frame.height / cut.zoom / 2);
      graph.push(
        `[${page}:v]crop=${width}:${height}:(iw-ow)/2:'min(ih-oh,${cut.pageFrom ?? PAGE_PAN_FROM}+${PAGE_PAN}*t)',scale=${size},setsar=1,fps=30[v${index}]`,
      );
    } else {
      const alpha = addInput(...seek, "-i", files.alpha!);
      const page = addInput(...still, "-i", files.page!);
      const person = `${overPage.presenter.width}:${overPage.presenter.height}`;
      graph.push(
        `[${clip}:v]scale=${person}[p${index}]`,
        `[${alpha}:v]scale=${person},format=gray[m${index}]`,
        `[p${index}][m${index}]alphamerge[c${index}]`,
        `[${page}:v]split[pa${index}][pf${index}]`,
        `[pa${index}]crop=${size}:0:0,boxblur=24,setsar=1[pb${index}]`,
        `[pf${index}]scale=${overPage.page.width}:-2,crop=${overPage.page.width}:${overPage.page.height}:0:'min(ih-oh,${OVER_PAGE_DRIFT}*t)'[pt${index}]`,
        `[pb${index}][pt${index}]overlay=${overPage.pageX}:0[b${index}]`,
        `[b${index}][c${index}]overlay=${overPage.presenterX}:H-h:shortest=1,setsar=1,fps=30[v${index}]`,
      );
    }
    graph.push(`[${audio}:a]${sound}[a${index}]`);
    parts.push(`[v${index}][a${index}]`);
  });

  if (files.endCard) {
    const seconds = END_CARD_SECONDS.toFixed(3);
    const colour = files.endCard.dark ? "0x101010" : "0xFFFFFF";
    const card = addInput(
      ...["-f", "lavfi", "-t", seconds],
      ...["-i", `color=c=${colour}:s=${frame.width}x${frame.height}:r=30`],
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
      `[${card}:v][${logo}:v]overlay=(W-w)/2:${layout.endCard.logoCentre}-h/2:shortest=1,setsar=1,fps=30[vcard]`,
      `[${silence}:a]${sound}[acard]`,
    );
    parts.push("[vcard][acard]");
  }

  if (files.music) {
    const music = addInput("-stream_loop", "-1", "-i", files.music);
    const fadeFrom = Math.max(0, plan.durationSeconds - MUSIC_FADE_SECONDS);
    graph.push(
      `${parts.join("")}concat=n=${parts.length}:v=1:a=1[cut][voice]`,
      `[${music}:a]${sound},volume=${files.clip || files.voice ? MUSIC_VOLUME : MUSIC_UNDER_WORDS_VOLUME},afade=t=out:st=${fadeFrom.toFixed(3)}:d=${MUSIC_FADE_SECONDS}[bed]`,
      "[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]",
    );
  } else {
    graph.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=1[cut][mix]`);
  }
  // As loud as the feeds play their own videos (about -14 LUFS).
  graph.push(`[mix]loudnorm=I=${LOUDNESS_LUFS}:TP=-1.5:LRA=11,${sound}[audio]`);
  // Each card fades in and out over the cut, under the captions.
  let picture = "cut";
  (files.cards ?? []).forEach((card, index) => {
    // A card shows within the video: never before it starts or after it ends.
    const start = Math.max(0, card.start);
    const end = Math.min(card.end, plan.durationSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end - start < 2 * CARD_FADE_SECONDS) return;
    const still = addInput(
      ...["-loop", "1", "-framerate", "30", "-t", end.toFixed(3)],
      ...["-i", card.png],
    );
    const fade = Math.min(CARD_FADE_SECONDS, (end - start) / 2).toFixed(3);
    graph.push(
      `[${still}:v]format=rgba,fade=t=in:st=${start.toFixed(3)}:d=${fade}:alpha=1,fade=t=out:st=${(end - Number(fade)).toFixed(3)}:d=${fade}:alpha=1[k${index}]`,
      `[${picture}][k${index}]overlay=0:0:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[over${index}]`,
    );
    picture = `over${index}`;
  });
  graph.push(
    `[${picture}]ass=${filterPath(files.subtitles)}:fontsdir=${filterPath(files.fontsDir)}[video]`,
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

/** What both kinds of edit can lay over their shots. */
interface EditExtras {
  /** The shape the video is cut in; vertical when not given. */
  shape?: VideoShape;
  /** A PNG of the logo fitted to `END_CARD_LOGO_BOX`, and the line under it. */
  endCard?: { logo: Uint8Array; dark: boolean; text: string };
  /** A generated clip for the hook. */
  broll?: Uint8Array;
  /** A generated instrumental, laid under the voice. */
  music?: Uint8Array;
  /** Designed stills over the cut (`renderVideoCards`), in the shape's frame. */
  cards?: { png: Uint8Array; start: number; end: number }[];
}

export interface TalkingVideoEditInput extends EditExtras {
  clip: Uint8Array;
  words: readonly SpokenWord[];
  clipSeconds: number;
  hookLine: string | null;
  /** The clip's matte and a screenshot of the brand's page, for site shots. */
  site?: { alpha: Uint8Array; page: Uint8Array };
}

export interface ShortVideoEditInput extends Omit<EditExtras, "broll"> {
  format: ShortVideoFormat;
  /** The voice, or none when the short's words are only on screen. */
  voice?: Uint8Array;
  /** When each word is spoken, or shown (`readingTimings`). */
  words: readonly SpokenWord[];
  /** The voice's length, or the words' reading time. */
  seconds: number;
  hookLine: string | null;
  /** The brand's pictures, each a JPEG the size of the shape's frame. */
  pictures: Uint8Array[];
  /** A screenshot of the brand's page, at least the frame's width and height. */
  page?: Uint8Array;
  /** A card with no picture behind it, as `0xRRGGBB`. */
  cardColour?: string;
  /** A launch's date and the brand its card is drawn in. */
  launch?: { date: string; brand: VideoCardBrand };
}

interface EditResult {
  bytes: Uint8Array;
  durationSeconds: number;
}

/** Writes the edit's files to a scratch folder, runs ffmpeg and reads the video. */
async function renderEdit(
  plan: TalkingVideoEditPlan,
  hookLine: string | null,
  sources: EditExtras & {
    clip?: Uint8Array;
    voice?: Uint8Array;
    alpha?: Uint8Array;
    page?: Uint8Array;
    pictures?: Uint8Array[];
    cardColour?: string;
  },
): Promise<EditResult> {
  const layout = VIDEO_LAYOUTS[sources.shape ?? "9:16"];
  const dir = await mkdtemp(path.join(tmpdir(), "talking-video-"));
  try {
    const pictures = (sources.pictures ?? []).map(
      (_, index) => `picture-${index}.jpg`,
    );
    const named: [string | undefined, Uint8Array | undefined][] = [
      [sources.clip && "clip.mp4", sources.clip],
      [sources.voice && "voice.mp3", sources.voice],
      [sources.alpha && "alpha.mp4", sources.alpha],
      [sources.page && "page.jpg", sources.page],
      [sources.endCard && "logo.png", sources.endCard?.logo],
      [sources.broll && "broll.mp4", sources.broll],
      [sources.music && "music.wav", sources.music],
      ...pictures.map(
        (name, index) =>
          [name, sources.pictures![index]] as [string, Uint8Array],
      ),
      ...(sources.cards ?? []).map(
        (card, index) =>
          [`card-${index}.png`, card.png] as [string, Uint8Array],
      ),
    ];
    await Promise.all([
      writeFile(
        path.join(dir, "captions.ass"),
        talkingVideoSubtitles(plan, hookLine, sources.endCard ?? null, layout),
      ),
      ...named.flatMap(([name, bytes]) =>
        name && bytes ? [writeFile(path.join(dir, name), bytes)] : [],
      ),
    ]);
    await runFfmpeg(
      talkingVideoEditArgs(
        plan,
        {
          subtitles: "captions.ass",
          fontsDir: await captionFontsDir(),
          output: "edited.mp4",
          ...(sources.clip ? { clip: "clip.mp4" } : {}),
          ...(sources.voice ? { voice: "voice.mp3" } : {}),
          ...(sources.alpha ? { alpha: "alpha.mp4" } : {}),
          ...(sources.page ? { page: "page.jpg" } : {}),
          ...(pictures.length ? { pictures } : {}),
          ...(sources.cardColour ? { cardColour: sources.cardColour } : {}),
          ...(sources.endCard
            ? { endCard: { logo: "logo.png", dark: sources.endCard.dark } }
            : {}),
          ...(sources.broll ? { broll: "broll.mp4" } : {}),
          ...(sources.music ? { music: "music.wav" } : {}),
          ...(sources.cards?.length
            ? {
                cards: sources.cards.map(({ start, end }, index) => ({
                  png: `card-${index}.png`,
                  start,
                  end,
                })),
              }
            : {}),
        },
        layout,
      ),
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

/** The edited video, or null when the clip has no word timings to plan from. */
export async function editTalkingVideo(
  input: TalkingVideoEditInput,
): Promise<EditResult | null> {
  const plan = planTalkingVideoEdit(input.words, input.clipSeconds, {
    siteShots: Boolean(input.site),
    endCard: Boolean(input.endCard),
    broll: Boolean(input.broll),
  });
  if (!plan) return null;
  const { site, ...rest } = input;
  return await renderEdit(plan, input.hookLine, {
    ...rest,
    ...(site ? { alpha: site.alpha, page: site.page } : {}),
  });
}

/** The short, or null when it has no words to time its shots by. */
export async function editShortVideo(
  input: ShortVideoEditInput,
): Promise<EditResult | null> {
  const plan = planShortVideo(input.words, input.seconds, {
    format: input.format,
    pictures: input.pictures.length,
    page: Boolean(input.page),
    endCard: Boolean(input.endCard),
  });
  if (!plan) return null;
  const card =
    plan.cardSpan && input.launch
      ? await launchCard(plan.cardSpan, input)
      : null;
  if (!card) return await renderEdit(plan, input.hookLine, input);
  // The card says it, so the captions under it and the hook line make way.
  const span = plan.cardSpan!;
  return await renderEdit(
    {
      ...plan,
      captions: plan.captions.filter(
        (caption) => caption.end <= span.start || caption.start >= span.end,
      ),
      hookSeconds: Math.min(plan.hookSeconds, span.start),
    },
    input.hookLine,
    { ...input, cards: [card] },
  );
}

/** A launch's date card over the sentence that says when, or null when it could not be drawn. */
async function launchCard(
  span: NonNullable<TalkingVideoEditPlan["cardSpan"]>,
  input: ShortVideoEditInput,
): Promise<{ png: Uint8Array; start: number; end: number } | null> {
  const { date, brand } = input.launch!;
  const pngs = await renderVideoCards(
    [{ kind: "date", date, text: input.hookLine ?? span.text }],
    brand,
    input.shape ?? "9:16",
  );
  return pngs?.[0] ? { png: pngs[0], start: span.start, end: span.end } : null;
}
