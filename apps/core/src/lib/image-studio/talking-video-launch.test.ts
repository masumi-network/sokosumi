import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderVideoCards, runFfmpeg } = vi.hoisted(() => ({
  renderVideoCards: vi.fn(),
  runFfmpeg: vi.fn(),
}));
vi.mock("./video-cards", () => ({ renderVideoCards }));
vi.mock("@/lib/ffmpeg", () => ({
  CAPTION_FONT_FAMILY: "Montserrat Black",
  captionFontsDir: async () => "/fonts",
  runFfmpeg,
}));

import { editShortVideo } from "./talking-video-edit";

/** "New winter menu. From 3 December. Come taste it." */
const WORDS = [
  ["New", "winter", "menu."],
  ["From", "3", "December."],
  ["Come", "taste", "it."],
].flatMap((sentence, index) =>
  sentence.map((text, word) => ({
    text,
    start: index * 1.5 + word * 0.4,
    end: index * 1.5 + word * 0.4 + 0.3,
  })),
);

const BRAND = { colors: ["#6400FF"], font: "Inter" };

let seen: { args: string[]; captions: string; files: string[] } | null = null;

beforeEach(() => {
  seen = null;
  renderVideoCards.mockReset();
  runFfmpeg.mockReset();
  runFfmpeg.mockImplementation(
    async (args: string[], { cwd }: { cwd: string }) => {
      const { readdir } = await import("node:fs/promises");
      seen = {
        args,
        captions: await readFile(path.join(cwd, "captions.ass"), "utf8"),
        files: await readdir(cwd),
      };
      await writeFile(path.join(cwd, "edited.mp4"), "video");
    },
  );
});

const launch = (extra: object = {}) =>
  editShortVideo({
    format: "launch",
    voice: new Uint8Array([1]),
    words: WORDS,
    seconds: 4.5,
    hookLine: "New winter menu",
    pictures: [new Uint8Array([2])],
    launch: { date: "3 December", brand: BRAND },
    ...extra,
  });

describe("a launch short", () => {
  it("shows its date card in the brand over the sentence that says when, without captions under it", async () => {
    renderVideoCards.mockResolvedValue([new Uint8Array([9])]);

    await launch({ shape: "4:5" });

    expect(renderVideoCards).toHaveBeenCalledWith(
      [{ kind: "date", date: "3 December", text: "New winter menu" }],
      BRAND,
      "4:5",
    );
    expect(seen!.files).toContain("card-0.png");
    expect(seen!.args.join(" ")).toMatch(/overlay.*between\(t,/);
    expect(seen!.captions).toContain("Caption,,0,0,0,,{\\c&H0000E6FF&}menu.");
    expect(seen!.captions).toContain("taste");
    expect(seen!.captions).not.toContain("December.");
    // The hook line makes way for the card that repeats it.
    expect(seen!.captions).toMatch(
      /0:00:00\.00,0:00:01\.\d\d,Hook,,0,0,0,,New winter menu/,
    );
  });

  it("is made with its captions and no card when the card cannot be drawn", async () => {
    renderVideoCards.mockResolvedValue(null);

    const edited = await launch();

    expect(edited).not.toBeNull();
    expect(seen!.files).not.toContain("card-0.png");
    expect(seen!.captions).toContain("December.");
  });

  it("draws no card for any other format", async () => {
    await launch({ format: "voiceover" });

    expect(renderVideoCards).not.toHaveBeenCalled();
    expect(seen!.captions).toContain("December.");
  });
});
