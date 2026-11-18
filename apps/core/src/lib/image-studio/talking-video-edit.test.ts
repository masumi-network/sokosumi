import { describe, expect, it } from "vitest";

import {
  planTalkingVideoEdit,
  TIKTOK_SAFE_AREA,
  talkingVideoEditArgs,
  talkingVideoSubtitles,
} from "./talking-video-edit";

/** "We roast it here. [0.5 s pause] Taste it today, friends." */
const WORDS = [
  { text: "We", start: 0.2, end: 0.3 },
  { text: "roast", start: 0.35, end: 0.6 },
  { text: "it", start: 0.65, end: 0.75 },
  { text: "here.", start: 0.8, end: 1.2 },
  { text: "Taste", start: 1.7, end: 2 },
  { text: "it", start: 2.05, end: 2.15 },
  { text: "today,", start: 2.2, end: 2.6 },
  { text: "friends.", start: 2.62, end: 3.1 },
];

describe("planTalkingVideoEdit", () => {
  it("cuts a pause out and punches in on the next sentence", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5)!;

    expect(plan.cuts).toEqual([
      {
        start: expect.closeTo(0.14),
        end: expect.closeTo(1.3),
        zoom: 1,
        shot: "camera",
      },
      {
        start: expect.closeTo(1.64),
        end: expect.closeTo(3.35),
        zoom: 1.2,
        shot: "camera",
      },
    ]);
    // 3.5 s of clip, less the lead-in, the pause and the tail.
    expect(plan.durationSeconds).toBeCloseTo(2.87);
  });

  it("changes the zoom between sentences that run on without a pause", () => {
    const plan = planTalkingVideoEdit(
      [
        { text: "One.", start: 0, end: 0.4 },
        { text: "Two.", start: 0.5, end: 0.9 },
      ],
      1,
    )!;

    expect(plan.cuts.map((cut) => cut.zoom)).toEqual([1, 1.2]);
    expect(plan.cuts[0]!.end).toBeCloseTo(plan.cuts[1]!.start);
    expect(plan.durationSeconds).toBeCloseTo(1);
  });

  it("keeps one zoom for a sentence cut in two by a pause", () => {
    const plan = planTalkingVideoEdit(
      [
        { text: "One", start: 0, end: 0.4 },
        { text: "two.", start: 1, end: 1.4 },
      ],
      2,
    )!;

    expect(plan.cuts.map((cut) => cut.zoom)).toEqual([1, 1]);
  });

  it("never ends a cut after the clip", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.15)!;

    expect(plan.cuts.at(-1)!.end).toBe(3.15);
  });

  it("shows two words at a time, never across a sentence or a cut", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5)!;

    expect(
      plan.captions.map((caption) => caption.words[caption.active]),
    ).toEqual(WORDS.map((word) => word.text));
    expect([
      ...new Set(plan.captions.map((caption) => caption.words.join(" "))),
    ]).toEqual(["We roast", "it here.", "Taste it", "today, friends."]);
  });

  it("times captions on the cut video, in order and inside it", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5)!;

    let previousEnd = 0;
    for (const caption of plan.captions) {
      expect(caption.start).toBeGreaterThanOrEqual(previousEnd - 1e-9);
      expect(caption.end).toBeGreaterThan(caption.start);
      previousEnd = caption.end;
    }
    expect(previousEnd).toBeLessThanOrEqual(plan.durationSeconds + 1e-9);
    // "Taste" starts the second cut, right after the first one's 1.16 s.
    expect(plan.captions[4]!.start).toBeCloseTo(1.16);
  });

  it("plans nothing without word timings", () => {
    expect(planTalkingVideoEdit([], 5)).toBeNull();
    expect(
      planTalkingVideoEdit([{ text: " ", start: 0, end: 1 }], 5),
    ).toBeNull();
  });
});

describe("talkingVideoSubtitles", () => {
  const plan = planTalkingVideoEdit(WORDS, 3.5)!;

  it("keeps captions and the hook line inside TikTok's safe area", () => {
    const styles = talkingVideoSubtitles(plan, "Fresh this week")
      .split("\n")
      .filter((line) => line.startsWith("Style: "))
      .map((line) => line.split(","));
    const margins = styles.map((style) => ({
      name: style[0],
      alignment: Number(style[18]),
      left: Number(style[19]),
      right: Number(style[20]),
      vertical: Number(style[21]),
    }));

    expect(margins).toEqual([
      // Bottom-centred: the text's lower edge sits at 1920 - 690 = 1230.
      {
        name: "Style: Caption",
        alignment: 2,
        left: 120,
        right: 120,
        vertical: 690,
      },
      // Top-centred, below the top bar.
      {
        name: "Style: Hook",
        alignment: 8,
        left: 120,
        right: 120,
        vertical: 290,
      },
      // The end card's line, under its logo.
      {
        name: "Style: Card",
        alignment: 8,
        left: 120,
        right: 120,
        vertical: 1010,
      },
    ]);
    expect(1920 - 690).toBeLessThanOrEqual(TIKTOK_SAFE_AREA.bottom);
    expect(290).toBeGreaterThanOrEqual(TIKTOK_SAFE_AREA.top);
  });

  it("colours the spoken word and shows the hook line for the first seconds", () => {
    const events = talkingVideoSubtitles(plan, "Fresh this week")
      .split("\n")
      .filter((line) => line.startsWith("Dialogue: "));

    expect(events[0]).toBe(
      "Dialogue: 1,0:00:00.00,0:00:02.87,Hook,,0,0,0,,Fresh this week",
    );
    expect(events[1]).toMatch(
      /^Dialogue: 0,0:00:00\.00,0:00:00\.15,Caption,,0,0,0,,\{\\c&H0000E6FF&\}We\{\\c&H00FFFFFF&\} roast$/,
    );
  });

  it("draws no hook line when there is none", () => {
    expect(talkingVideoSubtitles(plan, null)).not.toContain(",Hook,,");
  });

  it("strips characters that would start a subtitle command", () => {
    const text = talkingVideoSubtitles(plan, "{\\an5}Fresh\nweek");

    expect(text).toContain(",Hook,,0,0,0,,an5Fresh week");
  });
});

describe("talkingVideoEditArgs", () => {
  const files = {
    clip: "clip.mp4",
    subtitles: "captions.ass",
    fontsDir: "/tmp/fonts",
    output: "edited.mp4",
  };

  it("seeks each cut as its own input and crops the punched-in ones", () => {
    const args = talkingVideoEditArgs(planTalkingVideoEdit(WORDS, 3.5)!, files);

    expect(args.slice(0, 12)).toEqual([
      ...["-ss", "0.140", "-t", "1.160", "-i", "clip.mp4"],
      ...["-ss", "1.640", "-t", "1.710", "-i", "clip.mp4"],
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("[0:v]scale=1080:1920,crop=1080:1920:");
    expect(graph).toContain("[1:v]scale=1080:1920,crop=900:1600:");
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[cut][audio]");
    expect(graph).toContain("[cut]ass=captions.ass:fontsdir=/tmp/fonts[video]");
    expect(args.at(-1)).toBe("edited.mp4");
  });

  it("stands the presenter over the page with the clip's matte", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5, { siteShots: true })!;
    const args = talkingVideoEditArgs(plan, {
      ...files,
      site: { alpha: "alpha.mp4", page: "page.jpg" },
    });

    // The second cut reads the clip, its matte at the same time, and the page.
    expect(args.slice(6, 26)).toEqual([
      ...["-ss", "1.640", "-t", "1.710", "-i", "clip.mp4"],
      ...["-ss", "1.640", "-t", "1.710", "-i", "alpha.mp4"],
      ...["-loop", "1", "-framerate", "30", "-t", "1.710", "-i", "page.jpg"],
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("[p1][m1]alphamerge[c1]");
    expect(graph).toContain("[b1][c1]overlay=(W-w)/2:H-h:shortest=1");
    // The sound still comes from the clip.
    expect(graph).toContain("[1:a]aresample=44100");
  });

  it("ends on a card with the logo and silence", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5, { endCard: true })!;
    const args = talkingVideoEditArgs(plan, {
      ...files,
      endCard: { logo: "logo.png", dark: false },
    });

    expect(args).toContain("color=c=0xFFFFFF:s=1080x1920:r=30");
    expect(args).toContain("anullsrc=r=44100:cl=stereo");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(
      "[v0][a0][v1][a1][vcard][acard]concat=n=3:v=1:a=1[cut][audio]",
    );
  });
});

describe("site shots and the end card in the plan", () => {
  const sentence = (text: string, at: number) => ({
    text,
    start: at,
    end: at + 0.4,
  });
  const shots = (count: number) =>
    planTalkingVideoEdit(
      Array.from({ length: count }, (_, index) => sentence("Go.", index)),
      count,
      { siteShots: true },
    )!.cuts.map((cut) => cut.shot);

  it("keeps the hook and the last sentence to camera and shows the site between", () => {
    expect(shots(1)).toEqual(["camera"]);
    expect(shots(2)).toEqual(["camera", "over-page"]);
    expect(shots(3)).toEqual(["camera", "over-page", "camera"]);
    expect(shots(5)).toEqual([
      "camera",
      "over-page",
      "page",
      "over-page",
      "camera",
    ]);
  });

  it("stays on camera without site shots", () => {
    expect(
      planTalkingVideoEdit(WORDS, 3.5)!.cuts.map((cut) => cut.shot),
    ).toEqual(["camera", "camera"]);
  });

  it("adds the end card's length after the speech and labels it", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5, { endCard: true })!;

    expect(plan.speechSeconds).toBeCloseTo(2.87);
    expect(plan.durationSeconds).toBeCloseTo(4.57);
    expect(
      talkingVideoSubtitles(plan, null, { text: "cal.com", dark: true }),
    ).toContain("Dialogue: 1,0:00:02.87,0:00:04.57,Card,,0,0,0,,cal.com");
  });
});
