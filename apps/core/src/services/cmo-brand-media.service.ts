import {
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
} from "@sokosumi/database";
import { ssrfSafeFetch } from "@sokosumi/net";
import { type BrandBrain, brandBrainSchema } from "@sokosumi/soko-bot";
import { head, list } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import type { Browser } from "puppeteer-core";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import { driveOwnerOf } from "@/lib/drive-blob";
import { emitCoreWarning, runAsBackgroundWork } from "@/lib/evlog";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  capturePage,
  DESKTOP,
  MOBILE,
  type PageCapture,
  type SiteImage,
  type SiteSectionKind,
  withBrowser,
} from "@/lib/site-capture";
import { readRobots, readSitemapPages } from "@/lib/site-pages";
import type { CmoBrandMedia } from "@/schemas/cmo.schema";
import type { Cuso } from "@/services/cmo-cuso.service";
import { CMO_SITE_INDEX, cmoSiteIndexSchema } from "@/services/cmo-site-index";
import {
  type CusoDrive,
  cusoDrive,
  saveCusoProjectFile,
} from "@/services/cuso-project-files.service";

/** Where the material lands: the Project's files, in this Drive folder. */
export const CMO_BRAND_MEDIA_FOLDER = "Brand research";

/** Where the brand's logo files live, and what each is called (".png"). */
export const CMO_BRAND_LOGO_FOLDER = `${CMO_BRAND_MEDIA_FOLDER}/Logo`;
/** Where the whole site is documented, page by page (cmo-site-pages.service). */
export const CMO_BRAND_SITE_FOLDER = `${CMO_BRAND_MEDIA_FOLDER}/Site`;
export const CMO_BRAND_LOGO_FILES = {
  src: "logo",
  srcDark: "logo-dark",
  mark: "mark",
} as const;

/** Screenshot file names (without ".jpg") and how CMO labels them, in order. */
const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  pricing: "Pricing",
  product: "Product",
  customers: "Customers",
  about: "About",
  blog: "Blog",
  docs: "Docs",
};
/** A page's phone screenshot is named after the page: "pricing-mobile". */
const MOBILE_SUFFIX = "-mobile";

/** What a section is called where Cuso and CMO name it. */
const SECTION_LABELS: Record<SiteSectionKind, string> = {
  hero: "Hero",
  pricing: "Pricing cards",
  testimonials: "Testimonials",
  customers: "Customer logos",
  faq: "Questions and answers",
  product: "Product shot",
  features: "Feature section",
  cta: "Call to action",
  section: "Section",
};
const SECTION_NAME = new RegExp(
  `^(.+?)-(\\d{2})-(${Object.keys(SECTION_LABELS).join("|")})(?:-(.*))?$`,
);

/** The index of a capture, saved beside its files as index.json. */
const INDEX_FILE = "index.json";
const brandIndexSchema = z.object({
  /** Each page read, by its screenshot's file name. */
  pages: z.array(
    z.object({ name: z.string(), url: z.string(), title: z.string() }),
  ),
  /** Each section cut from a page, by its file name under Sections. */
  sections: z.array(
    z.object({ name: z.string(), title: z.string(), pageUrl: z.string() }),
  ),
});
type BrandIndex = z.infer<typeof brandIndexSchema>;

interface ResearchFile {
  fileId: string;
  pathname: string;
  /** "", "Competitors", "Pictures", "Sections", "Full pages" or "Logo". */
  folder: string;
  /** The file name without ".jpg" or ".png". */
  name: string;
}

/** A section file's page, kind and words, read from its name. */
function sectionOf(
  file: ResearchFile,
): { page: string; kind: SiteSectionKind; words: string } | null {
  const match =
    file.folder === "Sections" ? file.name.match(SECTION_NAME) : null;
  return match
    ? {
        page: match[1] as string,
        kind: match[3] as SiteSectionKind,
        words: (match[4] ?? "").replace(/-/g, " "),
      }
    : null;
}

/**
 * The brand research saved as the Project's files, newest first: what a
 * member confirmed on the Project (capture confirms each file it saves).
 */
async function listResearchFiles(
  projectId: string,
  /** Only files at this path under the folder ("Site/pages.json"). */
  within = "",
): Promise<ResearchFile[]> {
  const marker = `/${CMO_BRAND_MEDIA_FOLDER}/`;
  const links = await prisma.fileProjectLink.findMany({
    where: {
      projectId,
      state: FileMetadataState.CONFIRMED,
      resource: {
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        lifecycle: FileResourceLifecycle.ACTIVE,
        sourceId: { contains: `${marker}${within}` },
      },
    },
    select: { resource: { select: { id: true, sourceId: true } } },
    orderBy: { resource: { updatedAt: "desc" } },
  });
  const seen = new Set<string>();
  return links.flatMap(({ resource }) => {
    if (seen.has(resource.id)) return [];
    // Only the top-level folder: one of that name deeper down, say inside a
    // data room, is not Cuso's.
    if (
      !driveOwnerOf(resource.sourceId)?.path.startsWith(
        `${CMO_BRAND_MEDIA_FOLDER}/`,
      )
    )
      return [];
    seen.add(resource.id);
    const path = resource.sourceId.slice(
      resource.sourceId.indexOf(marker) + marker.length,
    );
    const slash = path.lastIndexOf("/");
    return [
      {
        fileId: resource.id,
        pathname: resource.sourceId,
        folder: slash === -1 ? "" : path.slice(0, slash),
        name: path.slice(slash + 1).replace(/\.(jpg|png)$/, ""),
      },
    ];
  });
}

/**
 * The pictures, one per slot ("01-red-sneaker"): a later capture whose
 * picture had other alt text saved a second file for the same slot.
 * shortcut: the older file stays in the Project; delete it on recapture if
 * stale pictures confuse members.
 */
function latestPictures(files: ResearchFile[]): ResearchFile[] {
  const slots = new Map<string, ResearchFile>();
  for (const file of files) {
    if (file.folder !== "Pictures") continue;
    const slot = file.name.match(/\d+/)?.[0] ?? file.name;
    if (!slots.has(slot)) slots.set(slot, file);
  }
  return [...slots.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, file]) => file);
}

/** "01-red-sneaker" reads "red sneaker"; "picture-02" had no alt text. */
function pictureAlt(name: string): string {
  return name
    .replace(/^(picture-)?\d+-?/, "")
    .replace(/-/g, " ")
    .trim();
}

/** Sections Cuso is offered: enough for a month, short enough for his context. */
const MAX_OFFERED_SECTIONS = 16;

/** Sections that show a page at its best: not a plain block or the questions. */
const SHOWN_SECTION_KINDS = new Set<SiteSectionKind>([
  "hero",
  "pricing",
  "testimonials",
  "customers",
  "product",
  "features",
  "cta",
]);

/** A brand picture Cuso can name, and what Core may show in its place. */
export interface CmoBrandPicture {
  fileId: string;
  alt: string;
  /** A page screenshot's phone shot, for a tall (9:16) picture or video. */
  phoneFileId?: string;
  /**
   * A page screenshot's desktop first screen and its best sections, for a
   * feed picture: each piece shows another of them.
   */
  wideFileIds?: string[];
}

/**
 * The brand's own pictures from the Project's files, references for images:
 * its page screenshots first (for software they are the product), then the
 * sections cut from those pages (pricing cards, testimonials, product shots;
 * a plain section last), then the photos from its pages. A page is offered
 * once, as its desktop shot where there is one; Core shows its phone shot or
 * one of its sections instead where the picture's shape asks for it.
 */
export async function listCmoBrandPictures(
  projectId: string,
): Promise<CmoBrandPicture[]> {
  const files = await listResearchFiles(projectId);
  const sectionFiles = files.flatMap((file) => {
    const section = sectionOf(file);
    return section ? [{ file, ...section }] : [];
  });
  const pageFile = (name: string) =>
    files.find((file) => file.folder === "" && file.name === name);
  const pages = Object.entries(PAGE_LABELS).flatMap(
    ([name, label]): CmoBrandPicture[] => {
      const desktop = pageFile(name);
      const phone = pageFile(`${name}${MOBILE_SUFFIX}`);
      if (!desktop) {
        return phone
          ? [
              {
                fileId: phone.fileId,
                alt: `${label} on a phone page screenshot`,
              },
            ]
          : [];
      }
      return [
        {
          fileId: desktop.fileId,
          alt: `${label} page screenshot`,
          ...(phone ? { phoneFileId: phone.fileId } : {}),
          wideFileIds: [
            desktop.fileId,
            ...sectionFiles
              .filter(
                (section) =>
                  section.page === name &&
                  SHOWN_SECTION_KINDS.has(section.kind),
              )
              .sort((a, b) => a.file.name.localeCompare(b.file.name))
              .map((section) => section.file.fileId),
          ],
        },
      ];
    },
  );
  const sections = sectionFiles
    .sort(
      (a, b) =>
        Number(a.kind === "section") - Number(b.kind === "section") ||
        a.file.name.localeCompare(b.file.name),
    )
    .slice(0, MAX_OFFERED_SECTIONS)
    .map(({ file, page, kind, words }) => ({
      fileId: file.fileId,
      alt: `${SECTION_LABELS[kind]}, ${PAGE_LABELS[page] ?? page} page${words ? `: ${words}` : ""}`,
    }));
  return [
    ...pages,
    ...sections,
    ...latestPictures(files).map((file) => ({
      fileId: file.fileId,
      alt: pictureAlt(file.name),
    })),
  ];
}

/**
 * The brand's full logo from the Project's files, and its version for a dark
 * background: what goes onto a picture. Null where research saved none.
 */
export async function readCmoBrandLogo(projectId: string): Promise<{
  logo: Uint8Array | null;
  dark: Uint8Array | null;
  /** The logo's Project file, which a styled picture is sent as its second image. */
  fileId: string | null;
}> {
  const files = await listResearchFiles(projectId);
  const find = (name: string) =>
    files.find(
      (candidate) => candidate.folder === "Logo" && candidate.name === name,
    );
  const bytes = async (name: string) => {
    const file = find(name);
    if (!file) return null;
    try {
      // Our own Blob store: its bot check refuses the SSRF-safe fetch.
      const response = await fetch((await head(file.pathname)).url, {
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    } catch {
      return null;
    }
  };
  const logo = await bytes(CMO_BRAND_LOGO_FILES.src);
  return {
    logo,
    dark: await bytes(CMO_BRAND_LOGO_FILES.srcDark),
    fileId: logo ? (find(CMO_BRAND_LOGO_FILES.src)?.fileId ?? null) : null,
  };
}

/**
 * A JSON file of the research (by its path under "Brand research"), read
 * from our own Blob store. Null when there is none or it does not parse.
 */
export async function readCmoResearchJson<T>(
  projectId: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<{ data: T; updatedAt: Date } | null> {
  const file = (await listResearchFiles(projectId, path)).find(
    (candidate) =>
      `${candidate.folder ? `${candidate.folder}/` : ""}${candidate.name}` ===
      path,
  );
  if (!file) return null;
  const blob = await head(file.pathname).catch(() => null);
  const data = blob ? await readJsonBlob(blob, schema) : null;
  return blob && data !== null ? { data, updatedAt: blob.uploadedAt } : null;
}

const indexes = new Map<string, BrandIndex | null>();

/** A capture's index.json, read once per upload of it. */
async function readBrandIndex(blob: {
  url: string;
  uploadedAt: Date;
}): Promise<BrandIndex | null> {
  const key = `${blob.url}?v=${blob.uploadedAt.getTime()}`;
  if (indexes.has(key)) return indexes.get(key) ?? null;
  // Our own Blob store: its bot check refuses the SSRF-safe fetch.
  const parsed = await fetch(key, { signal: AbortSignal.timeout(8_000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => brandIndexSchema.safeParse(body))
    .catch(() => null);
  if (!parsed) return null;
  const index = parsed.success ? parsed.data : null;
  indexes.set(key, index);
  return index;
}

/**
 * What CMO shows of the research, read from the Project's files: the pages
 * (home first, then home on a phone), each competitor the Brand Brain names
 * and the pictures. Null before research saved anything.
 */
export async function cmoBrandMedia(input: {
  projectId: string;
  websiteUrl: string;
  brain: BrandBrain | null;
}): Promise<CmoBrandMedia | null> {
  const files = await listResearchFiles(input.projectId);
  const first = files[0];
  if (!first) return null;
  const marker = `/${CMO_BRAND_MEDIA_FOLDER}/`;
  const prefix = first.pathname.slice(
    0,
    first.pathname.indexOf(marker) + marker.length,
  );
  const blobs = new Map<string, { url: string; uploadedAt: Date }>();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    for (const blob of page.blobs) blobs.set(blob.pathname, blob);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  // A new capture keeps the file name, so the stamp stops browsers and the
  // CDN from showing the one before.
  const shown = (file: ResearchFile) => {
    const blob = blobs.get(file.pathname);
    return blob
      ? {
          url: `${blob.url}?v=${blob.uploadedAt.getTime()}`,
          fileId: file.fileId,
        }
      : null;
  };
  const indexBlob = blobs.get(`${prefix}${INDEX_FILE}`);
  const index = indexBlob ? await readBrandIndex(indexBlob) : null;
  // A capture from before the index names its pages by what research cited.
  const ownPages = input.brain
    ? cmoOwnPages(input.websiteUrl, input.brain)
    : [];
  const pageUrl = (name: string) =>
    index?.pages.find((page) => page.name === name)?.url ??
    ownPages.find((page) => page.label === PAGE_LABELS[name])?.url ??
    new URL("/", input.websiteUrl).href;
  const labels = Object.keys(PAGE_LABELS);
  const order = (file: ResearchFile) =>
    labels.indexOf(file.name.replace(MOBILE_SUFFIX, "")) * 2 +
    Number(file.name.endsWith(MOBILE_SUFFIX));
  const pages = files
    .filter(
      (file) =>
        file.folder === "" && PAGE_LABELS[file.name.replace(MOBILE_SUFFIX, "")],
    )
    .sort((a, b) => order(a) - order(b))
    .flatMap((file) => {
      const saved = shown(file);
      if (!saved) return [];
      const mobile = file.name.endsWith(MOBILE_SUFFIX);
      const name = file.name.replace(MOBILE_SUFFIX, "");
      const full = mobile
        ? undefined
        : files.find(
            (candidate) =>
              candidate.folder === "Full pages" && candidate.name === name,
          );
      return [
        {
          ...saved,
          label: PAGE_LABELS[name] as string,
          pageUrl: pageUrl(name),
          device: mobile ? ("mobile" as const) : ("desktop" as const),
          fullUrl: (full ? shown(full)?.url : null) ?? null,
        },
      ];
    });
  // In the pages' order, each page's sections top to bottom.
  const sections = files
    .flatMap((file) => {
      const section = sectionOf(file);
      return section ? [{ file, section }] : [];
    })
    .sort(
      (a, b) =>
        labels.indexOf(a.section.page) - labels.indexOf(b.section.page) ||
        a.file.name.localeCompare(b.file.name),
    )
    .flatMap(({ file, section }) => {
      const saved = shown(file);
      if (!saved) return [];
      const indexed = index?.sections.find((entry) => entry.name === file.name);
      return [
        {
          ...saved,
          kind: section.kind,
          title: indexed?.title ?? section.words,
          pageLabel: PAGE_LABELS[section.page] ?? section.page,
          pageUrl: indexed?.pageUrl ?? pageUrl(section.page),
        },
      ];
    });
  const competitors = (
    input.brain ? cmoCompetitorPages(input.brain) : []
  ).flatMap((competitor) => {
    const file = files.find(
      (candidate) =>
        candidate.folder === "Competitors" &&
        candidate.name === cmoFileSlug(competitor.name),
    );
    const saved = file ? shown(file) : null;
    return saved
      ? [{ ...saved, name: competitor.name, pageUrl: competitor.url }]
      : [];
  });
  const pictures = latestPictures(files).flatMap((file) => {
    const saved = shown(file);
    return saved ? [{ ...saved, alt: pictureAlt(file.name) }] : [];
  });
  const logoFile = (name: string) => {
    const file = files.find(
      (candidate) => candidate.folder === "Logo" && candidate.name === name,
    );
    return (file && shown(file)) ?? null;
  };
  const siteBlob = blobs.get(`${prefix}${CMO_SITE_INDEX}`);
  const siteIndex = siteBlob
    ? await readJsonBlob(siteBlob, cmoSiteIndexSchema)
    : null;
  const siteShot = (name: string) => {
    const file = files.find(
      (candidate) => candidate.folder === "Site" && candidate.name === name,
    );
    return (file && shown(file)) ?? null;
  };
  const stamps = [...blobs.values()].map((blob) => blob.uploadedAt.getTime());
  if (stamps.length === 0) return null;
  return {
    capturedAt: new Date(Math.max(...stamps)).toISOString(),
    pages,
    sections,
    competitors,
    pictures,
    logos: {
      logo: logoFile(CMO_BRAND_LOGO_FILES.src),
      dark: logoFile(CMO_BRAND_LOGO_FILES.srcDark),
      mark: logoFile(CMO_BRAND_LOGO_FILES.mark),
    },
    ...(siteIndex && siteIndex.pages.length > 0
      ? {
          site: {
            pages: siteIndex.pages.map((page) => ({
              url: page.url,
              title: page.title,
              summary: page.summary,
              facts: page.facts,
              desktop: siteShot(page.name),
              phone: siteShot(`${page.name}${MOBILE_SUFFIX}`),
            })),
            complete: siteIndex.queue.length === 0,
          },
        }
      : {}),
  };
}

/** A JSON file of the research, read from its blob once per upload. */
async function readJsonBlob<T>(
  blob: { url: string; uploadedAt: Date },
  schema: z.ZodType<T>,
): Promise<T | null> {
  // Our own Blob store: its bot check refuses the SSRF-safe fetch.
  const body = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`, {
    signal: AbortSignal.timeout(8_000),
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** The homepage and one page of each kind. */
const MAX_OWN_PAGES = 7;
const MAX_COMPETITORS = 8;
const MAX_PICTURES = 12;
const MAX_PICTURE_BYTES = 6_000_000;
/** Pages captured at once in one browser. */
const PARALLEL = 3;

/** Paths worth a screenshot, best first; others (blog, legal, jobs) are not. */
const PAGE_KINDS: { label: string; pattern: RegExp }[] = [
  { label: "Pricing", pattern: /pric|preis|tarif|plans|\/abo(\/|$)/i },
  {
    label: "Product",
    pattern:
      /product|feature|platform|solution|how-it-works|leistung|angebot|menu|speisekarte|shop|collection|store/i,
  },
  { label: "Customers", pattern: /customer|case|stories|kunden|referenz/i },
  { label: "About", pattern: /about|ueber|über|team|company/i },
  { label: "Blog", pattern: /blog|news|journal|magazin|articles|insights/i },
  { label: "Docs", pattern: /docs|documentation|help|guide|support/i },
];

function sameSite(a: URL, b: URL): boolean {
  const host = (url: URL) => url.hostname.replace(/^www\./, "");
  return host(a) === host(b);
}

/**
 * The brand's pages to capture: the homepage, then one pricing, product,
 * customers, about, blog and docs page. A page the research cited comes
 * first, then the one the site links or lists (`found`: its header and
 * footer links, then its sitemap) with the shortest path, which is the
 * section's own page and not a post inside it.
 */
export function cmoOwnPages(
  websiteUrl: string,
  brain: BrandBrain,
  found: string[] = [],
): { label: string; url: string }[] {
  const site = new URL(websiteUrl);
  const onSite = (urls: (string | undefined)[]) =>
    urls
      .map((url) => (url ? URL.parse(url) : null))
      .filter((url): url is URL => url !== null && sameSite(url, site))
      .filter((url) => url.pathname.length > 1);
  const cited = onSite([
    ...brain.offers.map((offer) => offer.url),
    ...Object.values(brain.profile).flatMap(
      (section) => section?.findings.map((finding) => finding.sourceUrl) ?? [],
    ),
  ]);
  const listed = onSite(found).sort(
    (a, b) => a.pathname.length - b.pathname.length,
  );
  // A blog post about pricing is a blog page, wherever "pricing" stands in it.
  const kindOf = (url: URL) =>
    PAGE_KINDS.find((kind) =>
      kind.pattern.test(url.pathname.split("/")[1] ?? ""),
    )?.label;
  const pages = [{ label: "Home", url: new URL("/", site).href }];
  for (const kind of PAGE_KINDS) {
    // Most sites keep prices at /pricing; a page that is not there is skipped.
    const match =
      cited.find((url) => kind.pattern.test(url.pathname)) ??
      listed.find((url) => kindOf(url) === kind.label) ??
      (kind.label === "Pricing" ? new URL("/pricing", site) : undefined);
    if (match && !pages.some((page) => page.url === match.href)) {
      pages.push({
        label: kind.label,
        url: `${match.origin}${match.pathname}`,
      });
    }
    if (pages.length >= MAX_OWN_PAGES) break;
  }
  return pages;
}

/** Competitors with a homepage, as the Brand Brain lists them. */
export function cmoCompetitorPages(
  brain: BrandBrain,
): { name: string; url: string }[] {
  return brain.competitors
    .map((competitor) => {
      const url = competitor.url ? URL.parse(competitor.url) : null;
      return url
        ? { name: competitor.name, url: new URL("/", url).href }
        : null;
    })
    .filter((page): page is { name: string; url: string } => page !== null)
    .slice(0, MAX_COMPETITORS);
}

/** Runs `work` over `items`, `PARALLEL` at a time, keeping their order. */
async function inBatches<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += PARALLEL) {
    results.push(
      ...(await Promise.all(items.slice(start, start + PARALLEL).map(work))),
    );
  }
  return results;
}

export function cmoFileSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "page"
  );
}

async function downloadPicture(
  image: SiteImage,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const response = await ssrfSafeFetch(image.url, {
      maxResponseBytes: MAX_PICTURE_BYTES,
    });
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim();
    if (!response.ok || !contentType?.startsWith("image/")) return null;
    return { body: Buffer.from(await response.arrayBuffer()), contentType };
  } catch {
    return null;
  }
}

/**
 * The picture as a JPEG, drawn on a white canvas in the capture browser:
 * Instagram posts only JPEGs, and Cuso posts these photos as they are.
 */
async function asJpeg(
  browser: Browser,
  picture: { body: Buffer; contentType: string },
): Promise<Buffer | null> {
  if (picture.contentType === "image/jpeg") return picture.body;
  // A browser that died mid-capture costs this picture, never the capture.
  const page = await browser.newPage().catch(() => null);
  if (!page) return null;
  try {
    const jpeg = await page.evaluate(
      async (source: string) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return canvas.toDataURL("image/jpeg", 0.92);
      },
      `data:${picture.contentType};base64,${picture.body.toString("base64")}`,
    );
    return jpeg ? Buffer.from(jpeg.split(",")[1] ?? "", "base64") : null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}

const RECAPTURE_AFTER_MS = 10 * 60_000;
/** No page is started after this; a slow site costs pages, never the run. */
const CAPTURE_BUDGET_MS = 150_000;
/** How far down a page its full-page screenshot reaches. */
const FULL_PAGE_SCREENS = 8;
/** Sections cut from the homepage, and from each other page. */
const HOME_SECTIONS = 10;
const PAGE_SECTIONS = 6;
/** The homepage shots hiring takes first; they never hold up the full capture. */
const HOMEPAGE_FILES = ["home.jpg", "home-mobile.jpg"];
const capturing = new Set<string>();

/** A file a capture could not save, twice: what it was and why. */
export interface SaveFailure {
  folder: string;
  bytes: number;
  failure: ReturnType<typeof messageSafeErrorFields>;
}

/**
 * Saves one file of a capture, trying once more when it fails. A file that
 * cannot be saved is left out and noted in `failures`: it never ends the
 * capture, which is best effort file by file.
 */
export async function saveCmoResearchFile(
  drive: CusoDrive,
  target: { folder: string; filename: string },
  body: Buffer,
  contentType: string,
  failures?: SaveFailure[],
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await saveCusoProjectFile(drive, target, body, contentType);
    } catch (error) {
      if (attempt < 2) continue;
      failures?.push({
        folder: target.folder,
        bytes: body.byteLength,
        failure: messageSafeErrorFields(error),
      });
      return null;
    }
  }
}

function saveShot(
  drive: CusoDrive,
  folder: string,
  name: string,
  screenshot: Buffer,
  failures?: SaveFailure[],
): Promise<string | null> {
  return saveCmoResearchFile(
    drive,
    { folder, filename: `${cmoFileSlug(name)}.jpg` },
    screenshot,
    "image/jpeg",
    failures,
  );
}

/**
 * The homepage, on a desktop and on a phone, the moment Cuso is hired: it
 * needs nothing from research, so the Brand Brain opens with it. Each shot is
 * saved as soon as it is taken. Best effort, like the full capture.
 */
export async function captureCmoHomepage(
  cuso: Pick<Cuso, "workspaceId" | "sokoBotId" | "projectId" | "websiteUrl">,
): Promise<void> {
  const drive = await cusoDrive(cuso);
  if (!drive) return;
  const home = new URL("/", cuso.websiteUrl).href;
  if (!(await readRobots(home)).allows("/")) return;
  await withBrowser(async (browser: Browser) => {
    await Promise.all([
      capturePage(browser, home).then(
        (capture) =>
          capture &&
          saveShot(drive, CMO_BRAND_MEDIA_FOLDER, "home", capture.screenshot),
      ),
      capturePage(browser, home, MOBILE).then(
        (capture) =>
          capture &&
          saveShot(
            drive,
            CMO_BRAND_MEDIA_FOLDER,
            "home-mobile",
            capture.screenshot,
          ),
      ),
    ]);
  });
  nudgeFileIndexing();
}

/**
 * Captures in the background once Cuso saves the essentials (competitors
 * named, pages cited). A second essentials save in the same research, or one
 * while a capture runs here, does not start another.
 */
/** A Cuso whose capture read no page is tried again after this long. */
const RETRY_INDEX_AFTER_MS = 6 * 60 * 60_000;

/**
 * Starts the index for one Cuso who has none: hired before the index, or his
 * capture read no page. A Project counts as indexed once it has a page from
 * the top down (`Full pages/`), which only a capture that read a page saves;
 * a Project whose research files changed in the last six hours waits, so a
 * site that never loads is tried four times a day, not every sync. One per
 * call, so the backlog clears a Cuso a sync without crowding the browser.
 */
export async function scheduleMissingCmoBrandIndex(
  cusos: Pick<Cuso, "projectId" | "sokoBotId">[],
  now: Date = new Date(),
): Promise<boolean> {
  if (cusos.length === 0) return false;
  const links = await prisma.fileProjectLink.findMany({
    where: {
      projectId: { in: cusos.map((cuso) => cuso.projectId) },
      OR: [
        {
          resource: {
            sourceId: { contains: `/${CMO_BRAND_MEDIA_FOLDER}/Full pages/` },
          },
        },
        {
          updatedAt: { gte: new Date(now.getTime() - RETRY_INDEX_AFTER_MS) },
          resource: {
            sourceId: { contains: `/${CMO_BRAND_MEDIA_FOLDER}/` },
            // The site's pages are read on their own rhythm.
            NOT: { sourceId: { contains: `/${CMO_BRAND_SITE_FOLDER}/` } },
          },
        },
      ],
    },
    select: { projectId: true },
  });
  const skip = new Set(links.map((link) => link.projectId));
  const next = cusos.find((cuso) => !skip.has(cuso.projectId));
  if (next) scheduleCmoBrandMedia(next.sokoBotId);
  return next !== undefined;
}

export function scheduleCmoBrandMedia(sokoBotId: string): void {
  if (capturing.has(sokoBotId)) return;
  capturing.add(sokoBotId);
  waitUntil(
    runAsBackgroundWork(() =>
      captureCmoBrandMedia(sokoBotId)
        .catch((error) => {
          // After the response, and pages can carry what the brand wrote.
          emitCoreWarning(
            {
              operation: "cmo_brand_media",
              sokoBot: { id: sokoBotId },
              failure: messageSafeErrorFields(error),
            },
            {
              message: "Could not capture the brand's pages for Cuso",
              why: "The brand media capture threw",
              fix: "The Brand Brain opens without these pictures; Cuso's next essentials save captures again. If it repeats, look up the error name and code under failure.",
            },
          );
        })
        .finally(() => capturing.delete(sokoBotId)),
    ),
  );
}

/**
 * Indexes the brand's site, to show research and to make posts from: its
 * homepage and the pricing, product, customers, about, blog and docs pages
 * its header, footer and sitemap lead to (first screen, the page from the
 * top, and on a phone), every page cut into its sections (hero, pricing
 * cards, testimonials, customer logos, product shots, feature grids, the
 * closing call to action), the large pictures on those pages, and each
 * competitor's homepage. Everything is saved as the Project's files under
 * "Brand research", for every member and for later posts, each file as soon
 * as it is taken so CMO shows the first ones while the rest load; index.json
 * beside them names each page read and each section's heading. robots.txt
 * decides what is read, and nothing behind a sign-in is. Best effort: a page
 * that does not load is left out, and none is started once the time budget
 * is spent. Nothing runs when the last capture is minutes old; the homepage
 * shots and the logo hiring took do not count.
 */
export async function captureCmoBrandMedia(sokoBotId: string): Promise<void> {
  // The files are saved as Cuso's runner (ADR 0061). Loaded here: the CMO
  // service imports this module.
  const { findCusoForBot } = await import("@/services/cmo-cuso.service");
  // The workspace, website and Brand Brain are the Project's (ADR 0062).
  const cuso = await findCusoForBot(sokoBotId);
  const brain = brandBrainSchema.safeParse(cuso?.brandBrain);
  if (!cuso || !brain.success) return;
  const recent = await prisma.fileProjectLink.findFirst({
    where: {
      projectId: cuso.projectId,
      updatedAt: { gte: new Date(Date.now() - RECAPTURE_AFTER_MS) },
      resource: {
        sourceId: { contains: `/${CMO_BRAND_MEDIA_FOLDER}/` },
        NOT: [
          ...HOMEPAGE_FILES.map((name) => ({
            sourceId: { endsWith: `/${CMO_BRAND_MEDIA_FOLDER}/${name}` },
          })),
          { sourceId: { contains: `/${CMO_BRAND_LOGO_FOLDER}/` } },
          { sourceId: { contains: `/${CMO_BRAND_SITE_FOLDER}/` } },
        ],
      },
    },
    select: { id: true },
  });
  if (recent) return;
  const drive = await cusoDrive(cuso);
  if (!drive) return;
  const site = new URL("/", cuso.websiteUrl);
  const robots = await readRobots(site.origin);
  const competitorPages = cmoCompetitorPages(brain.data);
  // A Project without logo files gets the site's logo read again, beside
  // the capture: a Cuso hired before DESIGN.md named the full logo.
  const hasLogo = await prisma.fileProjectLink.findFirst({
    where: {
      projectId: cuso.projectId,
      resource: { sourceId: { contains: `/${CMO_BRAND_LOGO_FOLDER}/` } },
    },
    select: { id: true },
  });
  const logo = hasLogo
    ? null
    : import("@/services/cmo-brand-visual.service")
        .then(({ refreshCmoBrandLogo }) => refreshCmoBrandLogo(cuso))
        .catch(() => 0);
  const deadline = Date.now() + CAPTURE_BUDGET_MS;
  const inTime = () => Date.now() < deadline;
  const index: BrandIndex = { pages: [], sections: [] };
  const failures: SaveFailure[] = [];

  /**
   * Saves what one page of the brand gave, each file as it is ready. False
   * for an address that led to a page already saved (a guessed /pricing that
   * sends visitors home).
   */
  const saveOwnPage = async (label: string, capture: PageCapture) => {
    if (index.pages.some((page) => page.url === capture.url)) return false;
    const name = cmoFileSlug(label);
    index.pages.push({ name, url: capture.url, title: capture.title });
    await saveShot(
      drive,
      CMO_BRAND_MEDIA_FOLDER,
      name,
      capture.screenshot,
      failures,
    );
    if (capture.fullPage) {
      await saveShot(
        drive,
        `${CMO_BRAND_MEDIA_FOLDER}/Full pages`,
        name,
        capture.fullPage,
        failures,
      );
    }
    for (const [position, section] of capture.sections.entries()) {
      const file = [
        name,
        String(position + 1).padStart(2, "0"),
        section.kind,
        // A section without words (a video, a picture) is named by its kind.
        ...(/[a-z0-9]/i.test(section.title)
          ? [cmoFileSlug(section.title).slice(0, 40).replace(/-$/, "")]
          : []),
      ].join("-");
      index.sections.push({
        name: file,
        title: section.title,
        pageUrl: capture.url,
      });
      await saveShot(
        drive,
        `${CMO_BRAND_MEDIA_FOLDER}/Sections`,
        file,
        section.screenshot,
        failures,
      );
    }
    return true;
  };

  /** Where the capture is, so a failure says which step it ended in. */
  let step = "browser";
  let ownPagesMissed = 0;
  let stopped = false;
  try {
    const media = await withBrowser(async (browser: Browser) => {
      step = "home";
      const home = robots.allows("/")
        ? await capturePage(browser, site.href, {
            ...DESKTOP,
            fullScreens: FULL_PAGE_SCREENS,
            sections: HOME_SECTIONS,
          })
        : null;
      if (home) await saveOwnPage("Home", home);
      else if (robots.allows("/")) ownPagesMissed += 1;
      step = "pages";
      // The site's own header and footer say which pages matter; its sitemap
      // fills in what they leave out.
      const found = home
        ? [
            ...home.links.map((link) => link.url),
            ...(await readSitemapPages(site.origin, robots)),
          ]
        : [];
      const ownPages = cmoOwnPages(cuso.websiteUrl, brain.data, found)
        .slice(1)
        .filter((page) => robots.allows(new URL(page.url).pathname));
      const rest = await inBatches(ownPages, async (page) => {
        if (!inTime()) return null;
        const capture = await capturePage(browser, page.url, {
          ...DESKTOP,
          fullScreens: FULL_PAGE_SCREENS,
          sections: PAGE_SECTIONS,
        });
        if (!capture) ownPagesMissed += 1;
        return capture && (await saveOwnPage(page.label, capture))
          ? capture
          : null;
      });
      const own = [home, ...rest];
      step = "phones";
      await inBatches(index.pages, async (page) => {
        if (!inTime()) return;
        const phone = await capturePage(browser, page.url, MOBILE);
        if (phone) {
          await saveShot(
            drive,
            CMO_BRAND_MEDIA_FOLDER,
            `${page.name}${MOBILE_SUFFIX}`,
            phone.screenshot,
            failures,
          );
        }
      });
      step = "competitors";
      await inBatches(competitorPages, async (page) => {
        if (!inTime() || !(await readRobots(page.url)).allows("/")) return;
        const capture = await capturePage(browser, page.url);
        if (capture) {
          await saveShot(
            drive,
            `${CMO_BRAND_MEDIA_FOLDER}/Competitors`,
            page.name,
            capture.screenshot,
            failures,
          );
        }
      });
      step = "pictures";
      const seen = new Set<string>();
      const candidates = own
        .flatMap((capture) => capture?.images ?? [])
        .filter((image) => {
          const key = image.url.split("?")[0] ?? image.url;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, MAX_PICTURES);
      const pictures: { image: SiteImage; body: Buffer }[] = [];
      for (const image of candidates) {
        const picture = await downloadPicture(image);
        const body = picture ? await asJpeg(browser, picture) : null;
        if (body) pictures.push({ image, body });
      }
      return { pictures };
    });
    step = "save pictures";
    for (const [index, { image, body }] of media.pictures.entries()) {
      const slot = String(index + 1).padStart(2, "0");
      // The alt text names the picture, so Cuso finds a product's photo.
      const filename = image.alt.trim()
        ? `${slot}-${cmoFileSlug(image.alt)}.jpg`
        : `picture-${slot}.jpg`;
      await saveCmoResearchFile(
        drive,
        { folder: `${CMO_BRAND_MEDIA_FOLDER}/Pictures`, filename },
        body,
        "image/jpeg",
        failures,
      );
    }
  } catch (error) {
    stopped = true;
    // Pages can carry what the brand wrote: only the step, the counts and
    // the error's safe fields are logged.
    emitCoreWarning(
      {
        operation: "cmo_brand_media",
        sokoBot: { id: sokoBotId },
        brandMedia: {
          step,
          pagesRead: index.pages.length,
          sections: index.sections.length,
          ownPagesMissed,
        },
        failure: messageSafeErrorFields(error),
      },
      {
        message: "The brand capture stopped partway",
        why: "A step of the capture threw; what it saved before is kept",
        fix: "brandMedia.step names the step; at browser, the headless Chromium did not start. Cuso's next essentials save captures again.",
      },
    );
  } finally {
    await logo;
    // Written last and always, also after a capture that threw: it names
    // what was read. The backfill counts a page from the top down, not this.
    await saveCmoResearchFile(
      drive,
      { folder: CMO_BRAND_MEDIA_FOLDER, filename: INDEX_FILE },
      Buffer.from(JSON.stringify(index, null, 2)),
      "application/json",
      failures,
    );
    if (!stopped && ownPagesMissed > 0) {
      emitCoreWarning(
        {
          operation: "cmo_brand_media",
          sokoBot: { id: sokoBotId },
          brandMedia: {
            step: "pages",
            pagesRead: index.pages.length,
            ownPagesMissed,
          },
        },
        {
          message: "Some of the brand's pages did not load for the capture",
          why: "The headless browser returned no capture for them",
          fix: "The capture kept every page that loaded. If no page loads for any site, check the headless Chromium on Core.",
        },
      );
    }
    if (failures.length > 0) {
      const first = failures[0] as SaveFailure;
      emitCoreWarning(
        {
          operation: "cmo_brand_media_save",
          sokoBot: { id: sokoBotId },
          brandMedia: {
            failed: failures.length,
            folder: first.folder.replace(CMO_BRAND_MEDIA_FOLDER, "") || "/",
            bytes: first.bytes,
          },
          failure: first.failure,
        },
        {
          message: "Some of the brand's research files could not be saved",
          why: "Saving a capture file to the Project's Files failed twice",
          fix: "The capture kept every other file. If it repeats, look up the error name and code under failure and the file size under brandMedia.",
        },
      );
    }
  }
  nudgeFileIndexing();
}
