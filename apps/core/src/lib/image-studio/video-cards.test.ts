import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";

const { withBrowser } = vi.hoisted(() => ({ withBrowser: vi.fn() }));
vi.mock("@/lib/site-capture", () => ({ withBrowser }));
vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/ffmpeg", () => ({
  CAPTION_FONT_FAMILY: "Montserrat Black",
  captionFontsDir: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "card-font-"));
    await writeFile(path.join(dir, "Montserrat-Black.ttf"), "font");
    return dir;
  },
}));

import {
  cardColours,
  cardMayLoad,
  renderVideoCards,
  videoCardHtml,
} from "./video-cards";

describe("what a card's page may load", () => {
  it("is fonts over HTTPS from Google Fonts and its own data, nothing else", () => {
    expect(cardMayLoad("https://fonts.googleapis.com/css2?family=Inter")).toBe(
      true,
    );
    expect(cardMayLoad("https://fonts.gstatic.com/s/inter/v1/a.woff2")).toBe(
      true,
    );
    expect(cardMayLoad("data:font/ttf;base64,AAAA")).toBe(true);
    expect(cardMayLoad("http://fonts.googleapis.com/css2?family=Inter")).toBe(
      false,
    );
    expect(cardMayLoad("ws://fonts.gstatic.com/x")).toBe(false);
    expect(cardMayLoad("https://example.com/x.woff2")).toBe(false);
    expect(cardMayLoad("http://169.254.169.254/latest")).toBe(false);
    expect(cardMayLoad("not a url")).toBe(false);
  });

  it("shows no number that is not a count", () => {
    const html = videoCardHtml(
      { kind: "point", number: Number.NaN, text: "Beans" },
      { colors: [], font: null },
      "9:16",
    );
    expect(html).not.toContain("NaN");
    expect(html).not.toContain('class="number"');
  });
});

import { VIDEO_LAYOUTS } from "./video-layout";

describe("rendering cards past the deadline", () => {
  it("closes the browser and starts no next card", async () => {
    const newPage = vi.fn(async () => ({
      setViewport: async () => undefined,
      setRequestInterception: async () => undefined,
      on: () => undefined,
      // The first card's fonts never finish loading.
      setContent: () => new Promise(() => undefined),
      close: async () => undefined,
    }));
    const close = vi.fn(async () => undefined);
    let finished: Promise<unknown> | undefined;
    withBrowser.mockImplementation(
      (work: (browser: unknown) => Promise<unknown>) => {
        finished = work({ newPage, close });
        return finished;
      },
    );

    const pngs = await renderVideoCards(
      [
        { kind: "title", text: "One" },
        { kind: "title", text: "Two" },
      ],
      { colors: [], font: null },
      "9:16",
      50,
    );

    expect(pngs).toBeNull();
    expect(close).toHaveBeenCalled();
    expectCoreLog("warn", "Could not draw a video's cards in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(newPage).toHaveBeenCalledTimes(1);
  });
});

const BRAND = { colors: ["#6400FF", "#FFFFFF"], font: "Inter" };

describe("video cards", () => {
  it("draws a card in the frame of its shape, inside the part no overlay covers", () => {
    for (const shape of ["9:16", "4:5", "1:1", "16:9"] as const) {
      const { frame, safe } = VIDEO_LAYOUTS[shape];
      const html = videoCardHtml({ kind: "title", text: "Hi" }, BRAND, shape);
      expect(html).toContain(`width:${frame.width}px;height:${frame.height}px`);
      expect(html).toContain(`left:${safe.left}px;top:${safe.top}px`);
    }
  });

  it("uses the brand's colour, with ink that reads on it", () => {
    expect(cardColours(BRAND)).toEqual({ fill: "#6400FF", ink: "#FFFFFF" });
    expect(cardColours({ colors: ["#FFE600"], font: null })).toEqual({
      fill: "#FFE600",
      ink: "#101010",
    });
    // A brand without a usable colour gets a near-black card.
    expect(cardColours({ colors: ["purple"], font: null }).fill).toBe(
      "#101010",
    );
  });

  it("loads the brand's font by name, and only a plain family name", () => {
    expect(
      videoCardHtml({ kind: "title", text: "Hi" }, BRAND, "9:16"),
    ).toContain("fonts.googleapis.com/css2?family=Inter:");
    const odd = videoCardHtml(
      { kind: "title", text: "Hi" },
      { colors: [], font: 'Inter"><script>' },
      "9:16",
    );
    expect(odd).not.toContain("googleapis");
    expect(odd).not.toContain("<script>");
  });

  it("shows each kind's own parts and escapes the words", () => {
    const point = videoCardHtml(
      { kind: "point", number: 2, text: "Ships in <24h> & free" },
      BRAND,
      "4:5",
    );
    expect(point).toContain('<p class="number">2</p>');
    expect(point).toContain("Ships in &lt;24h&gt; &amp; free");
    expect(
      videoCardHtml({ kind: "label", label: "Myth", text: "x" }, BRAND, "1:1"),
    ).toContain('<p class="label">Myth</p>');
    expect(
      videoCardHtml(
        { kind: "offer", text: "20% off", detail: "until Friday" },
        BRAND,
        "16:9",
      ),
    ).toMatch(/class="big">20% off<\/p><p class="text">until Friday/);
    expect(
      videoCardHtml(
        { kind: "date", date: "3 December", text: "Doors open" },
        BRAND,
        "9:16",
      ),
    ).toContain('<p class="big">3 December</p>');
  });

  it("carries only the words it is given: no name or link of ours", () => {
    const html = videoCardHtml(
      { kind: "title", text: "Fresh beans" },
      BRAND,
      "9:16",
    );
    expect(html.toLowerCase()).not.toMatch(/sokosumi|soko bot|cuso/);
  });
});
