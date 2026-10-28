import { ssrfSafeFetch } from "@sokosumi/net";
import { type CmoBrandBrain, cmoBrandBrainSchema } from "@sokosumi/soko-bot";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import type { Browser } from "puppeteer-core";

import prisma from "@/lib/db/prisma";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  capturePage,
  MOBILE,
  type PageCapture,
  type SiteImage,
  withBrowser,
} from "@/lib/site-capture";
import { type CmoBrandMedia, cmoBrandMediaSchema } from "@/schemas/cmo.schema";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";

/** Where the material lands in the owner's Files. */
export const CMO_BRAND_MEDIA_FOLDER = "Brand research";

export function parseCmoBrandMedia(value: unknown): CmoBrandMedia | null {
  const parsed = cmoBrandMediaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const MAX_OWN_PAGES = 4;
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
];

function sameSite(a: URL, b: URL): boolean {
  const host = (url: URL) => url.hostname.replace(/^www\./, "");
  return host(a) === host(b);
}

/**
 * The brand's pages to capture: the homepage, then pricing, product,
 * customers and about pages the research cited, one of each.
 */
export function cmoOwnPages(
  websiteUrl: string,
  brain: CmoBrandBrain,
): { label: string; url: string }[] {
  const site = new URL(websiteUrl);
  const cited = [
    ...brain.offers.map((offer) => offer.url),
    ...Object.values(brain.profile).flatMap(
      (section) => section?.findings.map((finding) => finding.sourceUrl) ?? [],
    ),
  ]
    .map((url) => (url ? URL.parse(url) : null))
    .filter((url): url is URL => url !== null && sameSite(url, site))
    .filter((url) => url.pathname.length > 1);
  const pages = [{ label: "Home", url: new URL("/", site).href }];
  for (const kind of PAGE_KINDS) {
    // Most sites keep prices at /pricing; a page that is not there is skipped.
    const match =
      cited.find((url) => kind.pattern.test(url.pathname)) ??
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
  brain: CmoBrandBrain,
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

interface Drive {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}

/** Writes bytes into the owner's Files, as a re-upload when the name exists. */
async function saveToDrive(
  drive: Drive,
  path: { folder: string; filename: string },
  body: Buffer,
  contentType: string,
): Promise<{ url: string; fileId: string | null }> {
  const pathname = drive.organizationId
    ? buildOrganizationDriveFilePathnameWithFolder(
        drive.organizationId,
        path.folder,
        path.filename,
      )
    : buildUserDriveFilePathnameWithFolder(
        drive.userId,
        path.folder,
        path.filename,
      );
  const key = drive.organizationId
    ? {
        workspaceId: drive.workspaceId,
        scope: "organization" as const,
        ownerId: drive.organizationId,
        pathname,
      }
    : {
        workspaceId: drive.workspaceId,
        scope: "user" as const,
        ownerId: drive.userId,
        pathname,
      };
  await reserveDriveUploadResource({
    key,
    displayName: path.filename,
    mimeType: contentType,
    sizeBytes: body.length,
  });
  const blob = await put(pathname, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes: body.length,
    mimeType: contentType,
  });
  // A new capture keeps the file name, so the stamp stops browsers and the
  // CDN from showing the one before.
  return {
    url: `${blob.url}?v=${Date.now()}`,
    fileId: activated?.resourceId ?? null,
  };
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

function slug(text: string): string {
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
  const page = await browser.newPage();
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
    await page.close();
  }
}

const RECAPTURE_AFTER_MS = 10 * 60_000;
const capturing = new Set<string>();

/**
 * Captures in the background once Cuso saves the essentials (competitors
 * named, pages cited). A second essentials save in the same research, or one
 * while a capture runs here, does not start another.
 */
export function scheduleCmoBrandMedia(hire: {
  id: string;
  brandMedia: unknown;
}): void {
  const media = parseCmoBrandMedia(hire.brandMedia);
  if (media && Date.now() - Date.parse(media.capturedAt) < RECAPTURE_AFTER_MS)
    return;
  if (capturing.has(hire.id)) return;
  capturing.add(hire.id);
  waitUntil(
    captureCmoBrandMedia(hire.id)
      .catch((error) => {
        console.warn("CMO brand media failed", {
          cmoHireId: hire.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      })
      .finally(() => capturing.delete(hire.id)),
  );
}

/**
 * Captures what research can show, not just say: the brand's own pages (and
 * its homepage on a phone), each competitor's homepage, and the large
 * pictures on the brand's pages. Everything goes into the owner's Files under
 * "Brand research" for later posts, and onto the hire for the Brand Brain.
 * Best effort: a page that does not load is left out.
 */
export async function captureCmoBrandMedia(
  hireId: string,
): Promise<CmoBrandMedia | null> {
  const row = await prisma.cmoHire.findUnique({
    where: { id: hireId },
    select: {
      id: true,
      sokoBotId: true,
      project: {
        select: {
          workspaceId: true,
          websiteUrl: true,
          brandBrain: { select: { body: true } },
        },
      },
    },
  });
  // The workspace, website and Brand Brain are the Project's (ADR 0062).
  const hire = row && {
    id: row.id,
    sokoBotId: row.sokoBotId,
    workspaceId: row.project.workspaceId,
    websiteUrl: row.project.websiteUrl ?? "",
  };
  const brain = cmoBrandBrainSchema.safeParse(row?.project.brandBrain?.body);
  if (!hire || !brain.success) return null;
  // The files are saved as Cuso's runner (ADR 0061). Loaded here: the CMO
  // service imports this module.
  const { cmoRunnerUserId } = await import("@/services/cmo-cuso.service");
  const runnerId = await cmoRunnerUserId(hire);
  if (!runnerId) return null;
  const workspace = await prisma.workspace.findUnique({
    where: { id: hire.workspaceId },
    select: { organizationId: true },
  });
  if (!workspace) return null;
  const drive: Drive = {
    workspaceId: hire.workspaceId,
    organizationId: workspace.organizationId,
    userId: runnerId,
  };
  const ownPages = cmoOwnPages(hire.websiteUrl, brain.data);
  const competitorPages = cmoCompetitorPages(brain.data);

  const media = await withBrowser(async (browser: Browser) => {
    const own = await inBatches(ownPages, async (page) => ({
      page,
      capture: await capturePage(browser, page.url),
    }));
    const phone = await capturePage(
      browser,
      ownPages[0]?.url ?? hire.websiteUrl,
      MOBILE,
    );
    const rivals = await inBatches(competitorPages, async (page) => ({
      page,
      capture: await capturePage(browser, page.url),
    }));
    const seen = new Set<string>();
    const candidates = own
      .flatMap(({ capture }) => (capture as PageCapture | null)?.images ?? [])
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
    return { own, phone, rivals, pictures };
  });

  const pages: CmoBrandMedia["pages"] = [];
  for (const { page, capture } of media.own) {
    if (!capture) continue;
    const saved = await saveToDrive(
      drive,
      { folder: CMO_BRAND_MEDIA_FOLDER, filename: `${slug(page.label)}.jpg` },
      capture.screenshot,
      "image/jpeg",
    );
    pages.push({
      ...saved,
      label: page.label,
      pageUrl: capture.url,
      title: capture.title,
      device: "desktop",
    });
    if (page.label === "Home" && media.phone) {
      const phone = await saveToDrive(
        drive,
        { folder: CMO_BRAND_MEDIA_FOLDER, filename: "home-mobile.jpg" },
        media.phone.screenshot,
        "image/jpeg",
      );
      pages.push({
        ...phone,
        label: "Home on a phone",
        pageUrl: media.phone.url,
        title: media.phone.title,
        device: "mobile",
      });
    }
  }

  const competitors: CmoBrandMedia["competitors"] = [];
  for (const { page, capture } of media.rivals) {
    if (!capture) continue;
    const saved = await saveToDrive(
      drive,
      {
        folder: `${CMO_BRAND_MEDIA_FOLDER}/Competitors`,
        filename: `${slug(page.name)}.jpg`,
      },
      capture.screenshot,
      "image/jpeg",
    );
    competitors.push({ ...saved, name: page.name, pageUrl: capture.url });
  }

  const pictures: CmoBrandMedia["pictures"] = [];
  for (const [index, { image, body }] of media.pictures.entries()) {
    const saved = await saveToDrive(
      drive,
      {
        folder: `${CMO_BRAND_MEDIA_FOLDER}/Pictures`,
        filename: `picture-${String(index + 1).padStart(2, "0")}.jpg`,
      },
      body,
      "image/jpeg",
    );
    pictures.push({
      ...saved,
      sourceUrl: image.url,
      alt: image.alt,
      width: image.width,
      height: image.height,
    });
  }
  nudgeFileIndexing();

  const result: CmoBrandMedia = {
    capturedAt: new Date().toISOString(),
    pages,
    competitors,
    pictures,
  };
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { brandMedia: result },
  });
  return result;
}
