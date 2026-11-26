import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VideoShape } from "@sokosumi/utils";

import { CAPTION_FONT_FAMILY, captionFontsDir } from "@/lib/ffmpeg";
import { withBrowser } from "@/lib/site-capture";

import { VIDEO_LAYOUTS } from "./video-layout";

/**
 * Designed stills a video lays over its shots: a title, a numbered point, a
 * labelled line (Myth / Fact), an offer and a date. Each is drawn as HTML in
 * the brand's colour and font, screenshot by the Chromium Core already runs
 * for page captures to a transparent PNG the size of the frame, and laid
 * over the cut by ffmpeg. They carry only the words they are given: never a
 * name, link or mark of ours.
 */
export type VideoCard =
  | { kind: "title"; text: string }
  | { kind: "point"; number: number; text: string }
  | { kind: "label"; label: string; text: string }
  | { kind: "offer"; text: string; detail?: string }
  | { kind: "date"; date: string; text: string };

export interface VideoCardBrand {
  /** The brand's colours as `#RRGGBB`, its main one first. */
  colors: readonly string[];
  /** The brand's font, by family name. */
  font: string | null;
}

/** A card over the cut, from `start` to `end` seconds. */
export interface TimedVideoCard {
  png: Uint8Array;
  start: number;
  end: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Ink on a light accent, white on a dark one. */
const INK = "#101010";
const WHITE = "#FFFFFF";
/** A brand without a colour gets a near-black card. */
const NO_ACCENT = "#101010";
/** A family name we can put in a stylesheet and a Google Fonts address. */
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
const MAX_TEXT = 140;
const RENDER_TIMEOUT_MS = 30_000;
/** Font files the card page may load; every other request is refused. */
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

function clip(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

/** Rec. 601 luma of `#RRGGBB`, 0 to 255. */
function luma(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    0.299 * ((value >> 16) & 255) +
    0.587 * ((value >> 8) & 255) +
    0.114 * (value & 255)
  );
}

/** The card's fill, and the ink that reads on it. */
export function cardColours(brand: VideoCardBrand): {
  fill: string;
  ink: string;
} {
  const fill = brand.colors.find((colour) => HEX.test(colour)) ?? NO_ACCENT;
  return { fill, ink: luma(fill) > 150 ? INK : WHITE };
}

function cardFont(brand: VideoCardBrand): string | null {
  const font = brand.font?.trim();
  return font && FONT_NAME.test(font) ? font : null;
}

function body(card: VideoCard): string {
  const text = `<p class="text">${escapeHtml(clip(card.text))}</p>`;
  switch (card.kind) {
    case "title":
      return text;
    case "point":
      return `<p class="number">${Math.max(0, Math.round(card.number))}</p>${text}`;
    case "label":
      return `<p class="label">${escapeHtml(clip(card.label))}</p>${text}`;
    case "offer":
      return `<p class="big">${escapeHtml(clip(card.text))}</p>${
        card.detail
          ? `<p class="text">${escapeHtml(clip(card.detail))}</p>`
          : ""
      }`;
    case "date":
      return `<p class="big">${escapeHtml(clip(card.date))}</p>${text}`;
  }
}

/**
 * The card as a page the size of the frame, its panel centred in the part
 * no network overlay covers. `fallbackFont` is a stylesheet rule for the
 * caption font, used when the brand's font does not load.
 */
export function videoCardHtml(
  card: VideoCard,
  brand: VideoCardBrand,
  shape: VideoShape,
  fallbackFont = "",
): string {
  const { frame, safe, text } = VIDEO_LAYOUTS[shape];
  const { fill, ink } = cardColours(brand);
  const font = cardFont(brand);
  const family = [font && `"${font}"`, `"${CAPTION_FONT_FAMILY}"`, "sans-serif"]
    .filter(Boolean)
    .join(", ");
  const fontLink = font
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, "+")}:wght@600;800&display=block">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${fontLink}<style>
${fallbackFont}
html,body{margin:0;width:${frame.width}px;height:${frame.height}px;background:transparent;overflow:hidden}
.safe{position:absolute;left:${safe.left}px;top:${safe.top}px;width:${safe.right - safe.left}px;height:${safe.bottom - safe.top}px;display:flex;align-items:center;justify-content:center}
.card{box-sizing:border-box;max-width:100%;padding:${Math.round(text.card * 0.9)}px ${Math.round(text.card)}px;border-radius:${Math.round(text.card * 0.5)}px;background:${fill};color:${ink};font-family:${family};text-align:center}
p{margin:0}
.text{font-size:${text.card}px;font-weight:800;line-height:1.15}
.big{font-size:${Math.round(text.card * 1.6)}px;font-weight:800;line-height:1.05;margin-bottom:${Math.round(text.card * 0.3)}px}
.number{font-size:${text.number}px;font-weight:800;line-height:1}
.label{display:inline-block;font-size:${Math.round(text.label * 0.6)}px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;padding:0.2em 0.6em;margin-bottom:${Math.round(text.card * 0.4)}px;border:0.12em solid currentColor;border-radius:0.4em}
</style></head><body><div class="safe"><div class="card">${body(card)}</div></div></body></html>`;
}

/** The caption font as a stylesheet rule, so a card reads without the network. */
async function fallbackFontRule(): Promise<string> {
  const font = await readFile(
    path.join(await captionFontsDir(), "Montserrat-Black.ttf"),
  );
  return `@font-face{font-family:"${CAPTION_FONT_FAMILY}";src:url(data:font/ttf;base64,${font.toString("base64")}) format("truetype");font-weight:100 900}`;
}

/**
 * Each card as a transparent PNG the size of the shape's frame, in order.
 * Null when Chromium cannot draw them in time: the video is then made
 * without its cards, as it is without a site it cannot load.
 */
export async function renderVideoCards(
  cards: readonly VideoCard[],
  brand: VideoCardBrand,
  shape: VideoShape,
): Promise<Uint8Array[] | null> {
  if (cards.length === 0) return [];
  const { frame } = VIDEO_LAYOUTS[shape];
  const work = async () => {
    const fallback = await fallbackFontRule();
    return await withBrowser(async (browser) => {
      const pngs: Uint8Array[] = [];
      // A page per card: a second setContent on one intercepted page hung.
      for (const card of cards) {
        const page = await browser.newPage();
        await page.setViewport({ ...frame, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (url.protocol === "data:" || FONT_HOSTS.has(url.hostname))
            void request.continue();
          else void request.abort();
        });
        await page.setContent(videoCardHtml(card, brand, shape, fallback), {
          // The font stylesheet loads by "load"; fonts.ready waits for its files.
          waitUntil: "load",
          timeout: RENDER_TIMEOUT_MS,
        });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        pngs.push(
          await page.screenshot({
            type: "png",
            omitBackground: true,
            clip: { x: 0, y: 0, ...frame },
          }),
        );
        await page.close();
      }
      return pngs;
    });
  };
  return await Promise.race([
    work().catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), RENDER_TIMEOUT_MS),
    ),
  ]);
}
