import { describe, expect, it } from "vitest";

import {
  planShortVideo,
  planTalkingVideoEdit,
  readingTimings,
  TIKTOK_SAFE_AREA,
  talkingVideoEditArgs,
  talkingVideoSubtitles,
} from "./talking-video-edit";
import { VIDEO_LAYOUTS } from "./video-layout";

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
      // A short's label over a picture, at the hook's place.
      {
        name: "Style: Label",
        alignment: 8,
        left: 120,
        right: 120,
        vertical: 290,
      },
      // A list point's number, at the top.
      {
        name: "Style: Number",
        alignment: 8,
        left: 120,
        right: 120,
        vertical: 260,
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
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[cut][mix]");
    expect(graph).toContain("[cut]ass=captions.ass:fontsdir=/tmp/fonts[video]");
    expect(args.at(-1)).toBe("edited.mp4");
  });

  it("lays each card over the cut with a fade, under the captions", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5)!;
    const plain = talkingVideoEditArgs(plan, files);
    const args = talkingVideoEditArgs(plan, {
      ...files,
      cards: [
        { png: "card-0.png", start: 0.2, end: 1.4 },
        // Too short to fade in and out: left out.
        { png: "card-1.png", start: 2, end: 2.3 },
      ],
    });

    expect(args).toContain("card-0.png");
    expect(args).not.toContain("card-1.png");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(
      "fade=t=in:st=0.200:d=0.250:alpha=1,fade=t=out:st=1.150:d=0.250:alpha=1[k0]",
    );
    expect(graph).toContain(
      "[cut][k0]overlay=0:0:enable='between(t,0.200,1.400)'[over0]",
    );
    expect(graph).toContain(
      "[over0]ass=captions.ass:fontsdir=/tmp/fonts[video]",
    );
    // A card from before the video starts shows from its start; one with
    // no real end is left out.
    const early = talkingVideoEditArgs(plan, {
      ...files,
      cards: [
        { png: "early.png", start: -0.5, end: 0.9 },
        { png: "endless.png", start: 1, end: Number.NaN },
      ],
    });
    const earlyGraph = early[early.indexOf("-filter_complex") + 1]!;
    expect(earlyGraph).toContain("fade=t=in:st=0.000:");
    expect(earlyGraph).toContain("enable='between(t,0.000,0.900)'");
    expect(earlyGraph).not.toContain("-0.500");
    expect(early).not.toContain("endless.png");
    // Without cards the edit is what it was.
    expect(talkingVideoEditArgs(plan, { ...files, cards: [] })).toEqual(plain);
  });

  it("stands the presenter over the page with the clip's matte", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5, { siteShots: true })!;
    const args = talkingVideoEditArgs(plan, {
      ...files,
      alpha: "alpha.mp4",
      page: "page.jpg",
    });

    // The second cut reads the clip, its matte at the same time, and the page.
    expect(args.slice(6, 26)).toEqual([
      ...["-ss", "1.640", "-t", "1.710", "-i", "clip.mp4"],
      ...["-ss", "1.640", "-t", "1.710", "-i", "alpha.mp4"],
      ...["-loop", "1", "-framerate", "30", "-t", "1.710", "-i", "page.jpg"],
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("[p1][m1]alphamerge[c1]");
    // The presenter stands below the page's first screen, which shows
    // shrunk over a blurred copy: at full size its head hid NMKR's headline.
    expect(graph).toContain("[1:v]scale=540:960[p1]");
    expect(graph).toContain("[pf1]scale=810:-2,crop=810:1440:0:");
    expect(graph).toContain("[pb1][pt1]overlay=(W-w)/2:0[b1]");
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
      "[v0][a0][v1][a1][vcard][acard]concat=n=3:v=1:a=1[cut][mix]",
    );
  });
});

describe("the B-roll clip and the music", () => {
  /** One 4 s sentence, then a second one after a pause. */
  const LONG = [
    { text: "Your", start: 0.1, end: 0.5 },
    { text: "inbox", start: 0.6, end: 1.2 },
    { text: "is", start: 1.3, end: 1.6 },
    { text: "not", start: 1.7, end: 2.2 },
    { text: "a", start: 2.3, end: 2.5 },
    { text: "to-do", start: 2.6, end: 3.3 },
    { text: "list.", start: 3.4, end: 4 },
    { text: "Stop.", start: 4.6, end: 5 },
  ];

  it("cuts the clip into the hook after a second, for the rest of the sentence", () => {
    const plan = planTalkingVideoEdit(LONG, 5.5, { broll: true })!;

    expect(plan.cuts.map((cut) => [cut.shot, cut.start, cut.end])).toEqual([
      ["camera", expect.closeTo(0.04), expect.closeTo(1.04)],
      // 3.06 s are left, too little to come back to the presenter for.
      ["broll", expect.closeTo(1.04), expect.closeTo(4.1)],
      ["camera", expect.closeTo(4.54), expect.closeTo(5.25)],
    ]);
    // The cut changes nothing about what is said when.
    expect(plan.durationSeconds).toBeCloseTo(
      planTalkingVideoEdit(LONG, 5.5)!.durationSeconds,
    );
    expect(
      plan.captions.map((caption) => caption.words[caption.active]),
    ).toEqual(LONG.map((word) => word.text));
  });

  it("leaves a short hook to the presenter", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5, { broll: true })!;

    expect(plan.cuts.map((cut) => cut.shot)).toEqual(["camera", "camera"]);
  });

  it("plays the clip in its cut and loops the music under everything", () => {
    const plan = planTalkingVideoEdit(LONG, 5.5, { broll: true })!;
    const args = talkingVideoEditArgs(plan, {
      clip: "clip.mp4",
      subtitles: "captions.ass",
      fontsDir: "/tmp/fonts",
      output: "edited.mp4",
      broll: "broll.mp4",
      music: "music.wav",
    });

    expect(args.join(" ")).toContain("-t 3.060 -i broll.mp4");
    expect(args.join(" ")).toContain("-stream_loop -1 -i music.wav");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    );
    expect(graph).toContain(
      "[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]",
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

describe("planShortVideo", () => {
  /** Five one-second sentences. */
  const FIVE = ["Stop.", "One.", "Two.", "Three.", "Go."].map(
    (text, index) => ({
      text,
      start: index,
      end: index + 0.8,
    }),
  );
  const options = {
    pictures: 2,
    page: true,
    endCard: false,
  };
  const shots = (format: Parameters<typeof planShortVideo>[2]["format"]) =>
    planShortVideo(FIVE, 5, { ...options, format })!.cuts.map((cut) =>
      cut.shot === "picture" ? `picture ${cut.picture}` : cut.shot,
    );

  it("alternates the brand's pictures and its site in a story", () => {
    expect(shots("voiceover")).toEqual([
      "picture 0",
      "page",
      "picture 1",
      "page",
      "picture 0",
    ]);
  });

  it("walks down the site in a tour, every other shot inset", () => {
    const plan = planShortVideo(FIVE, 5, { ...options, format: "site_tour" })!;

    expect(plan.cuts.map((cut) => cut.shot)).toEqual(Array(5).fill("page"));
    expect(plan.cuts.map((cut) => cut.pageFrom)).toEqual([
      0, 640, 1280, 1920, 2560,
    ]);
    expect(plan.cuts.map((cut) => cut.zoom)).toEqual([1, 0.84, 1, 0.84, 1]);
  });

  it("numbers a list's three points and ends it on the site", () => {
    const plan = planShortVideo(FIVE, 5, { ...options, format: "top_three" })!;

    expect(plan.cuts.at(-1)!.shot).toBe("page");
    expect(
      plan.lines.map((line) => [line.style, line.text, line.start]),
    ).toEqual([
      ["Number", "1", expect.closeTo(plan.cuts[1]!.start - FIVE[0]!.start)],
      ["Number", "2", expect.any(Number)],
      ["Number", "3", expect.any(Number)],
    ]);
    // The hook line stays only over the sentence that names the list.
    expect(plan.hookSeconds).toBeCloseTo(plan.lines[0]!.start);
  });

  it("puts a slideshow's words on its pictures instead of captions", () => {
    const plan = planShortVideo(FIVE, 5, { ...options, format: "slideshow" })!;

    expect(plan.captions).toEqual([]);
    expect(plan.lines.map((line) => line.text)).toEqual(
      FIVE.map((word) => word.text),
    );
    expect(plan.lines.every((line) => line.style === "Label")).toBe(true);
    expect(shots("slideshow")).toEqual([
      "picture 0",
      "picture 1",
      "picture 0",
      "picture 1",
      "picture 0",
    ]);
  });

  it("cuts a long sentence into several shots on the same clock", () => {
    const long = [
      { text: "This", start: 0, end: 2 },
      { text: "runs", start: 2, end: 4 },
      { text: "long.", start: 4, end: 6 },
    ];
    const plan = planShortVideo(long, 6.5, {
      ...options,
      format: "voiceover",
    })!;

    expect(plan.cuts).toHaveLength(3);
    expect(plan.cuts[0]!.end).toBeCloseTo(plan.cuts[1]!.start);
    expect(plan.durationSeconds).toBeCloseTo(
      planTalkingVideoEdit(long, 6.5)!.durationSeconds,
    );
    expect(plan.captionBox).toBe(true);
  });

  it("falls back to the site, then to a card, without pictures", () => {
    expect(
      planShortVideo(FIVE, 5, {
        format: "slideshow",
        pictures: 0,
        page: true,
        endCard: false,
      })!.cuts[0]!.shot,
    ).toBe("page");
    expect(
      planShortVideo(FIVE, 5, {
        format: "slideshow",
        pictures: 0,
        page: false,
        endCard: false,
      })!.cuts[0]!.shot,
    ).toBe("card");
  });
});

describe("readingTimings", () => {
  it("times each line as a sentence, longer words longer", () => {
    const words = readingTimings("Shipped the code?\nNow ship it");

    expect(words.map((word) => word.text)).toEqual([
      "Shipped",
      "the",
      "code?",
      "Now",
      "ship",
      "it.",
    ]);
    expect(words[0]!.end - words[0]!.start).toBeGreaterThan(
      words[1]!.end - words[1]!.start,
    );
    // A held pause after each sentence.
    expect(words[2]!.end - words[2]!.start).toBeGreaterThan(0.6);
    expect(words[3]!.start).toBe(words[2]!.end);
  });
});

describe("a short's ffmpeg arguments", () => {
  const plan = planShortVideo(
    [
      { text: "One.", start: 0, end: 1 },
      { text: "Two.", start: 1.2, end: 2 },
    ],
    2.5,
    { format: "site_tour", pictures: 0, page: true, endCard: false },
  )!;

  it("pans the page, insets every other shot and lays the voice under it", () => {
    const args = talkingVideoEditArgs(plan, {
      voice: "voice.mp3",
      page: "page.jpg",
      subtitles: "captions.ass",
      fontsDir: "/tmp/fonts",
      output: "short.mp4",
      music: "music.wav",
    });
    const graph = args[args.indexOf("-filter_complex") + 1]!;

    expect(args.join(" ")).toContain("-i voice.mp3");
    expect(graph).toContain("crop=1080:1920:(iw-ow)/2:'min(ih-oh,0+70*t)'");
    expect(graph).toContain("[pb1][pt1]overlay=(W-w)/2:(H-h)/2");
    expect(graph).toContain("volume=0.3");
    expect(graph).toContain("[mix]loudnorm=I=-14");
  });

  it("plays the music up and silence under the cuts without a voice", () => {
    const args = talkingVideoEditArgs(plan, {
      pictures: ["picture-0.jpg"],
      subtitles: "captions.ass",
      fontsDir: "/tmp/fonts",
      output: "short.mp4",
      music: "music.wav",
    });
    const graph = args[args.indexOf("-filter_complex") + 1]!;

    expect(args).toContain("anullsrc=r=44100:cl=stereo");
    expect(graph).toContain("volume=0.9");
    // No page: the tour's shots fall back to the picture, panned.
    expect(graph).toContain("scale=1188:2112,crop=1080:1920:(iw-ow)/2:");
  });
});

describe("other shapes", () => {
  const files = {
    clip: "clip.mp4",
    subtitles: "captions.ass",
    fontsDir: "/tmp/fonts",
    output: "edited.mp4",
  };
  const graphOf = (args: string[]) =>
    args[args.indexOf("-filter_complex") + 1]!;

  it("crops a 4:5 camera shot below the top, where the head is", () => {
    const graph = graphOf(
      talkingVideoEditArgs(
        planTalkingVideoEdit(WORDS, 3.5)!,
        files,
        VIDEO_LAYOUTS["4:5"],
      ),
    );
    expect(graph).toContain(
      "[0:v]scale=1080:1920,crop=1080:1350:(iw-ow)/2:80,scale=1080:1350",
    );
    expect(graph).toContain("crop=900:1126:(iw-ow)/2:80");
  });

  it("shows a widescreen presenter whole between blurred copies of the clip", () => {
    const graph = graphOf(
      talkingVideoEditArgs(
        planTalkingVideoEdit(WORDS, 3.5)!,
        files,
        VIDEO_LAYOUTS["16:9"],
      ),
    );
    expect(graph).toContain(
      "[ca0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24",
    );
    expect(graph).toContain("[cf0]scale=-2:1080[cp0]");
    expect(graph).toContain("[cb0][cp0]overlay=(W-w)/2:0");
  });

  it("stands a widescreen presenter beside the page", () => {
    const plan = planTalkingVideoEdit(WORDS, 3.5, { siteShots: true })!;
    const graph = graphOf(
      talkingVideoEditArgs(
        plan,
        { ...files, alpha: "alpha.mp4", page: "page.jpg" },
        VIDEO_LAYOUTS["16:9"],
      ),
    );
    expect(graph).toContain("[pf1]scale=1240:-2,crop=1240:1080:0:");
    expect(graph).toContain("[pb1][pt1]overlay=80:0[b1]");
    expect(graph).toContain("[b1][c1]overlay=W-w-100:H-h:shortest=1");
  });

  it("sizes cards, pictures and subtitles to the frame", () => {
    const plan = planShortVideo(WORDS, 3.5, {
      format: "voiceover",
      pictures: 1,
      page: false,
      endCard: true,
    })!;
    const args = talkingVideoEditArgs(
      plan,
      {
        ...files,
        clip: undefined,
        voice: "voice.mp3",
        pictures: ["a.jpg"],
        endCard: { logo: "logo.png", dark: true },
      },
      VIDEO_LAYOUTS["1:1"],
    );
    expect(args).toContain("color=c=0x101010:s=1080x1080:r=30");
    expect(graphOf(args)).toContain("scale=1188:1188,crop=1080:1080:");
    expect(graphOf(args)).toContain("overlay=(W-w)/2:450-h/2");

    const subtitles = talkingVideoSubtitles(
      plan,
      "Hook",
      { text: "x.com", dark: true },
      VIDEO_LAYOUTS["1:1"],
    );
    expect(subtitles).toContain("PlayResY: 1080");
    const caption = subtitles
      .split("\n")
      .find((line) => line.startsWith("Style: Caption,"))!;
    // 80 high, 30 above the safe area's bottom, inside its sides.
    expect(caption.split(",")[2]).toBe("80");
    expect(caption.endsWith(",2,100,100,120,1")).toBe(true);
  });
});
