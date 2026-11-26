import { ssrfSafeFetch } from "@sokosumi/net";
import { isOwnedProjectLogoUrl } from "@sokosumi/utils";
import sharp from "sharp";

import { capturePage, withBrowser } from "@/lib/site-capture";

import { END_CARD_LOGO_BOX } from "./talking-video-edit";

/**
 * What a talking video shows of the brand besides its presenter: a screenshot
 * of its site behind them, and its logo on the end card. Both come from the
 * Project, and a video is made without either when it cannot be read.
 */

const FRAME = { width: 1080, height: 1920 } as const;
/** A phone-shaped page, three device pixels to one: 1080 wide like the video. */
const PHONE = { width: 360, height: 640, scale: 3, screens: 3 } as const;
/**
 * A desktop page for a widescreen video, one and a half device pixels to
 * one: 1920 wide like the frame.
 */
const DESKTOP_PAGE = { width: 1280, height: 720, scale: 1.5, screens: 3 };
const WIDE_FRAME = { width: 1920, height: 1080 } as const;
const CAPTURE_TIMEOUT_MS = 40_000;
const LOGO_TIMEOUT_MS = 15_000;
const MAX_LOGO_BYTES = 5_000_000;

/**
 * The site's first screens as a phone shows them, as a JPEG 1080 wide and at
 * least 1920 high, or as a desktop shows them, 1920 wide and at least 1080
 * high. Null when the page does not load in time.
 */
export async function captureTalkingVideoSitePage(
  websiteUrl: string,
  device: "phone" | "desktop" = "phone",
): Promise<Uint8Array | null> {
  const desktop = device === "desktop";
  const capture = await Promise.race([
    withBrowser((browser) =>
      capturePage(browser, websiteUrl, desktop ? DESKTOP_PAGE : PHONE),
    ).catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS),
    ),
  ]);
  if (!capture) return null;
  try {
    return await fitSitePage(capture.screenshot, desktop ? WIDE_FRAME : FRAME);
  } catch {
    return null;
  }
}

/** A page shorter than the frame is stood on its own background colour. */
export async function fitSitePage(
  screenshot: Uint8Array,
  frame: { width: number; height: number } = FRAME,
): Promise<Uint8Array> {
  const resized = sharp(screenshot).resize({ width: frame.width });
  const { height = 0 } = await sharp(await resized.toBuffer()).metadata();
  const { dominant } = await sharp(screenshot).stats();
  return await resized
    .extend({
      bottom: Math.max(0, frame.height - height),
      background: dominant,
    })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export interface TalkingVideoEndCard {
  /** A PNG of the logo, fitted to the card's logo box. */
  logo: Uint8Array;
  /** A light logo stands on a dark card, and a dark one on a light card. */
  dark: boolean;
  /** The line under the logo: the site's address, or the brand's name. */
  text: string;
}

/** The logo fitted to the card, and whether it needs a dark card to show. */
export async function fitEndCardLogo(
  bytes: Uint8Array,
): Promise<Pick<TalkingVideoEndCard, "logo" | "dark">> {
  const fitted = sharp(bytes, { density: 300 })
    .resize({ ...END_CARD_LOGO_BOX, fit: "inside", withoutEnlargement: false })
    .ensureAlpha();
  const { data, info } = await fitted
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let light = 0;
  let opaque = 0;
  for (let at = 0; at < data.length; at += info.channels) {
    const alpha = data[at + 3]! / 255;
    if (alpha < 0.5) continue;
    opaque += 1;
    // Rec. 601 luma.
    light += 0.299 * data[at]! + 0.587 * data[at + 1]! + 0.114 * data[at + 2]!;
  }
  return {
    logo: await fitted.png().toBuffer(),
    dark: opaque > 0 && light / opaque > 140,
  };
}

/**
 * The end card for a Project's videos, or null when it has no logo that can
 * be read. Our own logo store is read directly; any other address goes
 * through the SSRF-safe fetch.
 */
export async function loadTalkingVideoEndCard(project: {
  id: string;
  name: string;
  logo: string | null;
  websiteUrl: string | null;
}): Promise<TalkingVideoEndCard | null> {
  if (!project.logo) return null;
  try {
    const signal = AbortSignal.timeout(LOGO_TIMEOUT_MS);
    const response = isOwnedProjectLogoUrl(project.logo, project.id)
      ? await fetch(project.logo, { signal })
      : await ssrfSafeFetch(project.logo, {
          maxResponseBytes: MAX_LOGO_BYTES,
          signal,
        });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_LOGO_BYTES) return null;
    return {
      ...(await fitEndCardLogo(bytes)),
      text: siteAddress(project.websiteUrl) ?? project.name,
    };
  } catch {
    return null;
  }
}

/** A site's address as people say it: no scheme, no "www.", no trailing slash. */
export function siteAddress(websiteUrl: string | null): string | null {
  if (!websiteUrl) return null;
  try {
    const { hostname, pathname } = new URL(websiteUrl);
    const path = pathname.replace(/\/+$/, "");
    return `${hostname.replace(/^www\./, "")}${path.length <= 20 ? path : ""}`;
  } catch {
    return null;
  }
}
