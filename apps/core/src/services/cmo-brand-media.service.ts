import {
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
} from "@sokosumi/database";
import { ssrfSafeFetch } from "@sokosumi/net";
import { type CmoBrandBrain, cmoBrandBrainSchema } from "@sokosumi/soko-bot";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
} from "@sokosumi/utils";
import { list, put } from "@vercel/blob";
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
import type { CmoBrandMedia } from "@/schemas/cmo.schema";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import { updateFileMetadata } from "@/services/file-metadata.service";

/** Where the material lands: the Project's files, in this Drive folder. */
export const CMO_BRAND_MEDIA_FOLDER = "Brand research";

/** Screenshot file names (without ".jpg") and how CMO labels them, in order. */
const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  "home-mobile": "Home on a phone",
  pricing: "Pricing",
  product: "Product",
  customers: "Customers",
  about: "About",
};

interface ResearchFile {
  fileId: string;
  pathname: string;
  /** "", "Competitors" or "Pictures". */
  folder: string;
  /** The file name without ".jpg". */
  name: string;
}

/**
 * The brand research saved as the Project's files, newest first: what a
 * member confirmed on the Project (capture confirms each file it saves).
 */
async function listResearchFiles(projectId: string): Promise<ResearchFile[]> {
  const marker = `/${CMO_BRAND_MEDIA_FOLDER}/`;
  const links = await prisma.fileProjectLink.findMany({
    where: {
      projectId,
      state: FileMetadataState.CONFIRMED,
      resource: {
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        lifecycle: FileResourceLifecycle.ACTIVE,
        sourceId: { contains: marker },
      },
    },
    select: { resource: { select: { id: true, sourceId: true } } },
    orderBy: { resource: { updatedAt: "desc" } },
  });
  const seen = new Set<string>();
  return links.flatMap(({ resource }) => {
    if (seen.has(resource.id)) return [];
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
        name: path.slice(slash + 1).replace(/\.jpg$/, ""),
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

/** The brand's own photos from the Project's files: references for images. */
export async function listCmoBrandPictures(
  projectId: string,
): Promise<{ fileId: string; alt: string }[]> {
  return latestPictures(await listResearchFiles(projectId)).map((file) => ({
    fileId: file.fileId,
    alt: pictureAlt(file.name),
  }));
}

/**
 * What CMO shows of the research, read from the Project's files: the pages
 * (home first, then home on a phone), each competitor the Brand Brain names
 * and the pictures. Null before research saved anything.
 */
export async function cmoBrandMedia(input: {
  projectId: string;
  websiteUrl: string;
  brain: CmoBrandBrain | null;
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
  const ownPages = input.brain
    ? cmoOwnPages(input.websiteUrl, input.brain)
    : [];
  const labels = Object.keys(PAGE_LABELS);
  const pages = files
    .filter((file) => file.folder === "" && PAGE_LABELS[file.name])
    .sort((a, b) => labels.indexOf(a.name) - labels.indexOf(b.name))
    .flatMap((file) => {
      const saved = shown(file);
      if (!saved) return [];
      const mobile = file.name === "home-mobile";
      const label = PAGE_LABELS[file.name] as string;
      const page = ownPages.find(
        (candidate) => candidate.label === (mobile ? "Home" : label),
      );
      return [
        {
          ...saved,
          label,
          pageUrl: page?.url ?? new URL("/", input.websiteUrl).href,
          device: mobile ? ("mobile" as const) : ("desktop" as const),
        },
      ];
    });
  const competitors = (
    input.brain ? cmoCompetitorPages(input.brain) : []
  ).flatMap((competitor) => {
    const file = files.find(
      (candidate) =>
        candidate.folder === "Competitors" &&
        candidate.name === slug(competitor.name),
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
  const stamps = [...blobs.values()].map((blob) => blob.uploadedAt.getTime());
  if (stamps.length === 0) return null;
  return {
    capturedAt: new Date(Math.max(...stamps)).toISOString(),
    pages,
    competitors,
    pictures,
  };
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
  /** Cuso's Project: every saved file is confirmed as one of its files. */
  projectId: string;
}

/** Confirms the file on the Project, as Cuso's runner; best effort. */
async function linkToProject(drive: Drive, resourceId: string): Promise<void> {
  try {
    // The index job queued on upload may edit the metadata at the same time.
    for (let attempt = 0; attempt < 3; attempt++) {
      const resource = await prisma.fileResource.findUnique({
        where: { id: resourceId },
        select: { metadataRevision: true },
      });
      if (!resource) return;
      const outcome = await updateFileMetadata({
        workspaceId: drive.workspaceId,
        actor: {
          userId: drive.userId,
          organizationId: drive.organizationId,
          kind: "soko_bot",
        },
        resourceId,
        request: {
          expectedMetadataRevision: resource.metadataRevision,
          confirmProjectIds: [drive.projectId],
        },
      });
      if (outcome.status !== "conflict") return;
    }
  } catch (error) {
    console.warn("CMO brand media not linked to the Project", {
      projectId: drive.projectId,
      resourceId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Writes bytes into the organization's Files (the runner's when there is no
 * organization), as a re-upload when the name exists, and confirms the file
 * on the Project.
 */
async function saveToDrive(
  drive: Drive,
  path: { folder: string; filename: string },
  body: Buffer,
  contentType: string,
): Promise<void> {
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
  await put(pathname, body, {
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
  if (activated) await linkToProject(drive, activated.resourceId);
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
export function scheduleCmoBrandMedia(hire: { id: string }): void {
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
 * pictures on the brand's pages. Everything is saved as the Project's files
 * under "Brand research", for every member and for later posts. Best effort:
 * a page that does not load is left out. Nothing runs when the last capture
 * is minutes old.
 */
export async function captureCmoBrandMedia(hireId: string): Promise<void> {
  // The files are saved as Cuso's runner (ADR 0061). Loaded here: the CMO
  // service imports this module.
  const { cmoRunnerUserId, cmoHireView, CMO_HIRE_PROJECT } = await import(
    "@/services/cmo-cuso.service"
  );
  const row = await prisma.cmoHire.findUnique({
    where: { id: hireId },
    include: CMO_HIRE_PROJECT,
  });
  const hire = row ? cmoHireView(row) : null;
  const brain = cmoBrandBrainSchema.safeParse(hire?.brandBrain);
  if (!hire || !brain.success) return;
  const recent = await prisma.fileProjectLink.findFirst({
    where: {
      projectId: hire.projectId,
      updatedAt: { gte: new Date(Date.now() - RECAPTURE_AFTER_MS) },
      resource: { sourceId: { contains: `/${CMO_BRAND_MEDIA_FOLDER}/` } },
    },
    select: { id: true },
  });
  if (recent) return;
  const runnerId = await cmoRunnerUserId(hire);
  if (!runnerId) return;
  const workspace = await prisma.workspace.findUnique({
    where: { id: hire.workspaceId },
    select: { organizationId: true },
  });
  if (!workspace) return;
  const drive: Drive = {
    workspaceId: hire.workspaceId,
    organizationId: workspace.organizationId,
    userId: runnerId,
    projectId: hire.projectId,
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

  // File names carry what CMO shows and Cuso picks by (cmoBrandMedia).
  for (const { page, capture } of media.own) {
    if (!capture) continue;
    await saveToDrive(
      drive,
      { folder: CMO_BRAND_MEDIA_FOLDER, filename: `${slug(page.label)}.jpg` },
      capture.screenshot,
      "image/jpeg",
    );
    if (page.label === "Home" && media.phone) {
      await saveToDrive(
        drive,
        { folder: CMO_BRAND_MEDIA_FOLDER, filename: "home-mobile.jpg" },
        media.phone.screenshot,
        "image/jpeg",
      );
    }
  }

  for (const { page, capture } of media.rivals) {
    if (!capture) continue;
    await saveToDrive(
      drive,
      {
        folder: `${CMO_BRAND_MEDIA_FOLDER}/Competitors`,
        filename: `${slug(page.name)}.jpg`,
      },
      capture.screenshot,
      "image/jpeg",
    );
  }

  for (const [index, { image, body }] of media.pictures.entries()) {
    const slot = String(index + 1).padStart(2, "0");
    // The alt text names the picture, so Cuso finds a product's photo.
    const filename = image.alt.trim()
      ? `${slot}-${slug(image.alt)}.jpg`
      : `picture-${slot}.jpg`;
    await saveToDrive(
      drive,
      { folder: `${CMO_BRAND_MEDIA_FOLDER}/Pictures`, filename },
      body,
      "image/jpeg",
    );
  }
  nudgeFileIndexing();
}
