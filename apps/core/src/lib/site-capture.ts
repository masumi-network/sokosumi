import { ssrfSafeFetch, ssrfSafeStreamFetch } from "@sokosumi/net";
import type { Browser, HTTPRequest, HTTPResponse, Page } from "puppeteer-core";

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
  /** Where the page's header and footer lead on its own site. */
  links: SiteLink[];
  /** JPEG of the page from the top, when `fullScreens` asked for it. */
  fullPage?: Buffer;
  /** The page cut into its sections, top to bottom, when `sections` asked. */
  sections: SiteSection[];
}

export interface SiteLink {
  url: string;
  text: string;
  place: "header" | "footer";
}

/** What a section of a page is for, read from its markup and words. */
export type SiteSectionKind =
  | "hero"
  | "pricing"
  | "testimonials"
  | "customers"
  | "faq"
  | "product"
  | "features"
  | "cta"
  | "section";

export interface SiteSection {
  kind: SiteSectionKind;
  /** Its heading, or its first words. */
  title: string;
  /** JPEG of the section alone. */
  screenshot: Buffer;
}

export interface SiteImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export const DESKTOP = { width: 1440, height: 900 } as const;
export const MOBILE = { width: 390, height: 844 } as const;

/** A capture's viewport, and optionally a sharper or taller screenshot. */
export interface CaptureViewport {
  width: number;
  height: number;
  /** Device pixels per CSS pixel; 1 when omitted. */
  scale?: number;
  /** How many screens down the screenshot reaches; 1 when omitted. */
  screens?: number;
  /** Also keep the page from the top, this many screens at most. */
  fullScreens?: number;
  /** Also cut the page into its sections, this many at most. */
  sections?: number;
}

const NAVIGATION_TIMEOUT_MS = 20_000;
const NETWORK_IDLE_TIMEOUT_MS = 8_000;
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
 * Opens the address and waits for a quiet network as far as it comes. Not
 * Chrome's own network-idle signal: with requests intercepted it never came
 * for entry.fyi at desktop width, though every request had finished.
 */
async function loadPage(page: Page, url: string): Promise<HTTPResponse | null> {
  const response = await page
    .goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS })
    .catch(() => null);
  if (response)
    await page
      .waitForNetworkIdle({
        idleTime: 500,
        concurrency: 2,
        timeout: NETWORK_IDLE_TIMEOUT_MS,
      })
      .catch(() => undefined);
  return response;
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
  viewport: CaptureViewport = DESKTOP,
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
  viewport: CaptureViewport,
): Promise<PageCapture | null> {
  const target = await finalUrl(url);
  const page = await browser.newPage();
  const abort = new AbortController();
  try {
    const { width, height, scale = 1, screens = 1 } = viewport;
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    // The bundler wraps named functions in `__name(...)`, which a function
    // sent into the page would not find there.
    await page.evaluateOnNewDocument("globalThis.__name = (fn) => fn");
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void guardRequest(request, abort.signal);
    });
    const load = () => loadPage(page, target);
    let response = await load();
    if (response && (await missingStyles(page))) response = await load();
    if (!response || response.status() >= 400 || (await missingStyles(page)))
      return null;
    await declineCookies(page);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    // Lazy pictures load only once they scroll into view.
    const scrollThrough = () =>
      page
        .evaluate(async () => {
          for (let screen = 1; screen <= 6; screen++) {
            window.scrollTo(0, window.innerHeight * screen);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        })
        .catch(() => undefined);
    let clip: { x: number; y: number; width: number; height: number } | null =
      null;
    if (screens > 1) {
      await scrollThrough();
      const pageHeight = await page.evaluate(() => {
        window.scrollTo(0, 0);
        return document.documentElement.scrollHeight;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      clip = {
        x: 0,
        y: 0,
        width,
        height: Math.max(height, Math.min(pageHeight, height * screens)),
      };
    }
    const screenshot = Buffer.from(
      await page.screenshot({
        type: "jpeg",
        quality: JPEG_QUALITY,
        ...(clip ? { clip } : {}),
      }),
    );
    if (!clip) await scrollThrough();
    const fullPage = viewport.fullScreens
      ? await fullPageShot(page, width, height * viewport.fullScreens)
      : undefined;
    return {
      url: page.url(),
      title: (await page.title()).slice(0, 200),
      screenshot,
      images: await largeImages(page),
      links: await siteLinks(page),
      ...(fullPage ? { fullPage } : {}),
      sections: viewport.sections
        ? await pageSections(page, viewport.sections)
        : [],
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
    const response = await loadPage(page, await finalUrl(url));
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

/** The page from the top down to `maxHeight`, lazy content already loaded. */
async function fullPageShot(
  page: Page,
  width: number,
  maxHeight: number,
): Promise<Buffer | undefined> {
  try {
    const pageHeight = await page.evaluate(() => {
      window.scrollTo(0, 0);
      return document.documentElement.scrollHeight;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return Buffer.from(
      await page.screenshot({
        type: "jpeg",
        quality: JPEG_QUALITY,
        clip: { x: 0, y: 0, width, height: Math.min(pageHeight, maxHeight) },
      }),
    );
  } catch {
    return undefined;
  }
}

const MAX_LINKS = 80;

/** Links in the page's header and footer that stay on its site. */
async function siteLinks(page: Page): Promise<SiteLink[]> {
  const found = await page
    .evaluate(() => {
      const host = (name: string) => name.replace(/^www\./, "");
      return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((anchor) => {
          const place = anchor.closest("footer, [role=contentinfo]")
            ? ("footer" as const)
            : anchor.closest("header, nav, [role=banner], [role=navigation]")
              ? ("header" as const)
              : null;
          return { anchor, place };
        })
        .filter(
          (
            link,
          ): link is {
            anchor: HTMLAnchorElement;
            place: "header" | "footer";
          } =>
            link.place !== null &&
            /^https?:$/.test(link.anchor.protocol) &&
            host(link.anchor.hostname) === host(location.hostname),
        )
        .map(({ anchor, place }) => ({
          url: `${anchor.origin}${anchor.pathname}`,
          text: (anchor.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          place,
        }));
    })
    .catch(() => [] as SiteLink[]);
  const seen = new Set<string>();
  return found
    .filter((link) => (seen.has(link.url) ? false : (seen.add(link.url), true)))
    .slice(0, MAX_LINKS);
}

interface SectionBox {
  kind: SiteSectionKind;
  title: string;
  y: number;
  height: number;
}

/** A section shorter than this is a divider or a strip, not material. */
const MIN_SECTION_HEIGHT = 220;
/** How long a section gets to finish fading in before its screenshot. */
const SECTION_SETTLE_MS = 600;
/** A JPEG this small for its size is an empty block. */
const MIN_BYTES_PER_PIXEL = 0.012;

/**
 * The page's sections, each as its own screenshot with what it is for: the
 * hero, pricing cards, testimonials, a wall of customer logos, a product
 * shot, a feature grid, questions, the closing call to action.
 */
async function pageSections(page: Page, limit: number): Promise<SiteSection[]> {
  const viewport = page.viewport();
  if (!viewport) return [];
  const boxes = await page
    .evaluate(findSections, MIN_SECTION_HEIGHT, limit)
    .catch(() => [] as SectionBox[]);
  // A header that follows the scroll would sit on top of every section.
  await page
    .evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        const position = getComputedStyle(element).position;
        if (position === "fixed" || position === "sticky")
          element.style.setProperty("visibility", "hidden", "important");
      }
    })
    .catch(() => undefined);
  const sections: SiteSection[] = [];
  for (const box of boxes) {
    try {
      // Blocks fade in once they are on screen, and some fade out again at
      // its top edge, so the section is brought to the middle.
      await page.evaluate(
        (y: number, height: number) =>
          window.scrollTo(
            0,
            y - Math.max(0, (window.innerHeight - height) / 2),
          ),
        box.y,
        box.height,
      );
      await new Promise((resolve) => setTimeout(resolve, SECTION_SETTLE_MS));
      const screenshot = Buffer.from(
        await page.screenshot({
          type: "jpeg",
          quality: JPEG_QUALITY,
          clip: { x: 0, y: box.y, width: viewport.width, height: box.height },
        }),
      );
      if (
        screenshot.byteLength <
        viewport.width * box.height * MIN_BYTES_PER_PIXEL
      )
        continue;
      sections.push({ kind: box.kind, title: box.title, screenshot });
    } catch {
      // One section that cannot be drawn does not lose the rest.
    }
  }
  return sections;
}

/**
 * Runs in the page. Walks down from the body: a wide block of about a
 * screen is a section, a taller one is opened for the sections inside it.
 */
export function findSections(minHeight: number, limit: number): SectionBox[] {
  const screen = window.innerHeight;
  const maxHeight = screen * 1.6;
  const pageWidth = document.documentElement.clientWidth;
  const found: { element: Element; y: number; height: number }[] = [];
  const visit = (element: Element, depth: number) => {
    for (const child of element.children) {
      if (
        /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEADER|NAV|FOOTER|ASIDE)$/.test(
          child.tagName,
        )
      )
        continue;
      const style = getComputedStyle(child);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.position === "fixed" ||
        style.position === "sticky" ||
        child.closest("[role=banner], [role=contentinfo], [role=dialog]") ||
        /footer|cookie|consent/i.test(`${child.id} ${child.className}`)
      )
        continue;
      const rect = child.getBoundingClientRect();
      // A screen-high wrapper (`h-full`) whose content runs past it holds
      // the whole page: its scroll height says so, its box does not.
      const tall = Math.max(rect.height, child.scrollHeight);
      if (rect.width < pageWidth * 0.6 || tall < minHeight) continue;
      const before = found.length;
      if (tall > maxHeight && depth < 6) visit(child, depth + 1);
      if (found.length > before) continue;
      found.push({
        element: child,
        y: Math.max(0, Math.round(rect.top + window.scrollY)),
        height: Math.round(Math.min(rect.height, maxHeight)),
      });
    }
  };
  visit(document.body, 0);

  const words = (element: Element) =>
    ((element as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
  const last = found.length - 1;
  return found
    .sort((a, b) => a.y - b.y)
    .map(({ element, y, height }, index) => {
      const text = words(element);
      const lower = text.toLowerCase();
      const names = `${element.id} ${element.className}`.toLowerCase();
      const heading = element.querySelector("h1, h2, h3");
      const pictures = [
        ...element.querySelectorAll("img, svg, video, canvas, picture"),
      ].map((picture) => picture.getBoundingClientRect());
      const smallPictures = pictures.filter(
        (rect) => rect.height > 12 && rect.height <= 90 && rect.width <= 260,
      ).length;
      const biggest = Math.max(
        0,
        ...pictures.map((rect) => rect.width * rect.height),
      );
      const prices = lower.match(
        /[$€£]\s?\d|\d\s?(€|usd|eur|chf)\b|\/\s?(mo|month|monat|year|jahr)\b|per (month|seat|user)/g,
      );
      let kind: SectionBox["kind"] = "section";
      if (index === 0 && element.querySelector("h1")) kind = "hero";
      else if ((prices?.length ?? 0) >= 3 || /pricing|preise/.test(names))
        kind = "pricing";
      else if (
        element.querySelector("blockquote") ||
        /testimonial|review|quote/.test(names) ||
        /what (our )?(customers|clients|users|people) (say|think)|loved by|kundenstimmen/.test(
          lower,
        )
      )
        kind = "testimonials";
      else if (
        (smallPictures >= 5 && text.length < 240) ||
        /trusted by|used by|backed by|as seen (in|on)|our (customers|clients|partners)|logos?\b/.test(
          `${lower.slice(0, 160)} ${names}`,
        )
      )
        kind = "customers";
      else if (
        element.querySelectorAll("details").length >= 3 ||
        /\bfaq\b|frequently asked|häufige fragen/.test(
          `${lower.slice(0, 200)} ${names}`,
        )
      )
        kind = "faq";
      else if (biggest >= rect(element).width * height * 0.3) kind = "product";
      else if (element.querySelectorAll("h3, h4").length >= 3)
        kind = "features";
      else if (
        index >= last - 1 &&
        text.length < 320 &&
        element.querySelector("a[href], button")
      )
        kind = "cta";
      return {
        kind,
        title: (heading ? words(heading) : text).slice(0, 90),
        y,
        height,
      };
    })
    .slice(0, limit);

  function rect(element: Element): DOMRect {
    return element.getBoundingClientRect();
  }
}
