import { ssrfSafeFetch, ssrfSafeStreamFetch } from "@sokosumi/net";
import type { Browser, HTTPRequest, Page } from "puppeteer-core";

import { getEnv } from "@/config/env";

/** What one page looked like: its screenshot and the pictures on it. */
export interface PageCapture {
  /** The address after redirects. */
  url: string;
  title: string;
  /** JPEG of the first screen. */
  screenshot: Buffer;
  /** Large pictures on the page, biggest first. */
  images: SiteImage[];
}

export interface SiteImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export const DESKTOP = { width: 1440, height: 900 } as const;
export const MOBILE = { width: 390, height: 844 } as const;

const NAVIGATION_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500;
const MAX_RESOURCE_BYTES = 8_000_000;
const JPEG_QUALITY = 72;
/** Smaller pictures are icons, avatars and logos, not material. */
const MIN_IMAGE_WIDTH = 480;
const MIN_IMAGE_HEIGHT = 270;
const MAX_IMAGES = 8;
/** Pages open at once in this process: more starve each other's requests. */
const MAX_OPEN_PAGES = 3;
/** Requests a page cannot render without; one that fails is tried again. */
const ESSENTIAL = new Set(["document", "stylesheet", "script", "font"]);

let openPages = 0;
const waiting: (() => void)[] = [];

async function openSlot(): Promise<() => void> {
  if (openPages >= MAX_OPEN_PAGES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  openPages++;
  return () => {
    openPages--;
    waiting.shift()?.();
  };
}

/**
 * Runs `work` with a headless Chromium: a local Chrome when
 * `CHROMIUM_EXECUTABLE_PATH` is set, else the `@sparticuz/chromium-min` pack
 * (Vercel). The browser always closes.
 */
export async function withBrowser<T>(
  work: (browser: Browser) => Promise<T>,
): Promise<T> {
  const env = getEnv();
  const puppeteer = await import("puppeteer-core");
  let browser: Browser;
  if (env.CHROMIUM_EXECUTABLE_PATH) {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: env.CHROMIUM_EXECUTABLE_PATH,
    });
  } else {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    chromium.setGraphicsMode = false;
    browser = await puppeteer.launch({
      args: chromium.args,
      headless: true,
      executablePath: await chromium.executablePath(
        env.CHROMIUM_EXECUTABLE_URL,
      ),
    });
  }
  try {
    return await work(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Opens a public page and captures its first screen and its large pictures.
 * Every request goes through the SSRF-safe fetch, so a page cannot reach a
 * private address. Cookie banners are declined, or hidden when there is no
 * button to decline. A page whose stylesheets did not all load is loaded
 * once more; still broken, it is left out rather than shown unstyled. Null
 * when the page does not load.
 */
export async function capturePage(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number } = DESKTOP,
): Promise<PageCapture | null> {
  const release = await openSlot();
  try {
    return await capture(browser, url, viewport);
  } finally {
    release();
  }
}

async function capture(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
): Promise<PageCapture | null> {
  const target = await finalUrl(url);
  const page = await browser.newPage();
  const abort = new AbortController();
  try {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void guardRequest(request, abort.signal);
    });
    const load = () =>
      page
        .goto(target, {
          waitUntil: "networkidle2",
          timeout: NAVIGATION_TIMEOUT_MS,
        })
        .catch(() => null);
    let response = await load();
    if (response && (await missingStyles(page))) response = await load();
    if (!response || response.status() >= 400 || (await missingStyles(page)))
      return null;
    await declineCookies(page);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const screenshot = Buffer.from(
      await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY }),
    );
    // Lazy pictures load only once they scroll into view.
    await page
      .evaluate(async () => {
        for (let screen = 1; screen <= 6; screen++) {
          window.scrollTo(0, window.innerHeight * screen);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      })
      .catch(() => undefined);
    return {
      url: page.url(),
      title: (await page.title()).slice(0, 200),
      screenshot,
      images: await largeImages(page),
    };
  } catch {
    return null;
  } finally {
    abort.abort();
    await page.close().catch(() => undefined);
  }
}

/**
 * The text a visitor reads on a page once it has rendered, with sign-in
 * prompts declined like cookie banners. Same request guard as a capture.
 * Null when the page does not load.
 */
export async function readPageText(
  browser: Browser,
  url: string,
): Promise<string | null> {
  const release = await openSlot();
  const page = await browser.newPage();
  const abort = new AbortController();
  try {
    await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void guardRequest(request, abort.signal);
    });
    const response = await page
      .goto(await finalUrl(url), {
        waitUntil: "networkidle2",
        timeout: NAVIGATION_TIMEOUT_MS,
      })
      .catch(() => null);
    if (!response || response.status() >= 400) return null;
    await declineCookies(page);
    await page
      .evaluate(async () => {
        for (let screen = 1; screen <= 3; screen++) {
          window.scrollTo(0, window.innerHeight * screen);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      })
      .catch(() => undefined);
    const text = await page.evaluate(() => document.body.innerText);
    return text.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return null;
  } finally {
    abort.abort();
    await page.close().catch(() => undefined);
    release();
  }
}

async function guardRequest(
  request: HTTPRequest,
  signal: AbortSignal,
): Promise<void> {
  const url = request.url();
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    await request.continue().catch(() => undefined);
    return;
  }
  const method = request.method().toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    await request.abort("blockedbyclient").catch(() => undefined);
    return;
  }
  try {
    const fetchOnce = () =>
      ssrfSafeFetch(url, {
        method,
        maxResponseBytes: MAX_RESOURCE_BYTES,
        signal,
      });
    const response = await fetchOnce().catch((error: unknown) => {
      if (signal.aborted || !ESSENTIAL.has(request.resourceType())) throw error;
      return fetchOnce();
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (
        !/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(
          key,
        )
      ) {
        headers[key] = value;
      }
    });
    await request.respond({
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      headers,
      body: Buffer.from(await response.arrayBuffer()),
    });
  } catch {
    await request.abort("blockedbyclient").catch(() => undefined);
  }
}

/**
 * Where a page really lives after its redirects (apple.com → www.apple.com).
 * The request guard follows redirects itself, so a browser opened on the old
 * address would render the new page's HTML under the wrong origin and lose
 * its styles. Falls back to the address given.
 */
export async function finalUrl(url: string): Promise<string> {
  let current = url;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const response = await ssrfSafeStreamFetch(current, {
        maxResponseBytes: MAX_RESOURCE_BYTES,
      });
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location)
        return current;
      current = new URL(location, current).href;
    }
  } catch {
    // Unreachable or not identity-encoded: the browser tries the address.
  }
  return current;
}

/** True when a stylesheet the page links did not load. */
async function missingStyles(page: Page): Promise<boolean> {
  return page
    .evaluate(() =>
      [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      ].some(
        (link) =>
          !link.disabled && !link.media.includes("print") && !link.sheet,
      ),
    )
    .catch(() => true);
}

/** Declines a cookie banner, or hides it when it offers no way to decline. */
async function declineCookies(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const decline =
        /^(reject( all)?|decline( all)?|deny|only (necessary|essential)|necessary only|essential only|alle ablehnen|ablehnen|nur notwendige|refuser|tout refuser|rifiuta|rechazar)$/i;
      const buttons = [
        ...document.querySelectorAll<HTMLElement>(
          "button, a[role=button], [role=button]",
        ),
      ];
      const button = buttons.find((candidate) =>
        decline.test((candidate.textContent ?? "").trim()),
      );
      if (button) {
        button.click();
        return;
      }
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        const style = getComputedStyle(element);
        if (
          (style.position === "fixed" || style.position === "sticky") &&
          /cookie|consent|privacy|gdpr/i.test(
            `${element.id} ${element.className} ${element.textContent?.slice(0, 400)}`,
          ) &&
          element.getBoundingClientRect().height < window.innerHeight * 0.9
        ) {
          element.style.display = "none";
        }
      }
    })
    .catch(() => undefined);
}

async function largeImages(page: Page): Promise<SiteImage[]> {
  const found = await page
    .evaluate(
      (minWidth: number, minHeight: number) =>
        [...document.images]
          .filter(
            (image) =>
              image.naturalWidth >= minWidth &&
              image.naturalHeight >= minHeight &&
              /^https?:/.test(image.currentSrc || image.src) &&
              !/\.svg(\?|$)/i.test(image.currentSrc || image.src),
          )
          .map((image) => ({
            url: image.currentSrc || image.src,
            width: image.naturalWidth,
            height: image.naturalHeight,
            alt: (image.alt ?? "").slice(0, 200),
          })),
      MIN_IMAGE_WIDTH,
      MIN_IMAGE_HEIGHT,
    )
    .catch(() => [] as SiteImage[]);
  const seen = new Set<string>();
  return found
    .filter((image) => {
      const key = image.url.split("?")[0] ?? image.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_IMAGES);
}
