import { ssrfSafeFetch } from "@sokosumi/net";
import {
  designMdBrandLook,
  designMdLogo,
  designMdPalette,
} from "@sokosumi/utils";
import sharp from "sharp";
import { getEnv } from "@/config/env";
import { type BrandVisual, readBrandVisual } from "@/lib/brand-visual";
import prisma from "@/lib/db/prisma";
import {
  readDesignMdContent,
  uploadDesignMdContent,
} from "@/lib/design-md-blob";
import { recordCoreWarning } from "@/lib/evlog";
import { decodeEntities } from "@/lib/open-graph-html";
import { resolveSiteIconAsProjectLogo } from "@/lib/site-icon";
import {
  CMO_BRAND_LOGO_FILES,
  CMO_BRAND_LOGO_FOLDER,
} from "@/services/cmo-brand-media.service";
import type { Cuso } from "@/services/cmo-cuso.service";
import {
  cusoDrive,
  saveCusoProjectFile,
} from "@/services/cuso-project-files.service";
import { cmoPathSiteResponse } from "@/services/evals/cmo-path/sites";

/** The brand's look as CMO shows it, read from the Project. */
export interface CmoBrandVisual {
  logoUrl: string | null;
  colors: string[];
  fonts: string[];
  siteName: string | null;
  designMdUrl: string | null;
  images: string[];
}

/**
 * Name, colours and fonts in a DESIGN.md: its front matter's `name` and
 * `fontFamily` entries (CSS `font-family` too), and its palette (primary,
 * secondary, accent, background and text; never a status colour).
 */
export function brandLookFromDesignMd(
  content: string,
): Pick<CmoBrandVisual, "colors" | "fonts" | "siteName"> {
  const name = content
    .match(/^---\n[\s\S]*?^name:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return {
    colors: designMdPalette(content),
    fonts: designMdBrandLook(content).fonts,
    siteName: name ? decodeEntities(name).slice(0, 120) : null,
  };
}

/**
 * The brand's look from the Project's logo and DESIGN.md, with `images` (the
 * Brand research pictures) for post previews. Null when the Project has
 * neither.
 */
export async function cmoBrandVisual(
  project: { logo: string | null; designMdUrl: string | null },
  images: string[],
): Promise<CmoBrandVisual | null> {
  if (!project.logo && !project.designMdUrl) return null;
  const designMd = await readDesignMdContent(project.designMdUrl);
  return {
    logoUrl: project.logo,
    ...(designMd
      ? brandLookFromDesignMd(designMd)
      : { colors: [], fonts: [], siteName: null }),
    designMdUrl: project.designMdUrl,
    images: images.slice(0, 8),
  };
}

/**
 * A DESIGN.md of what the site's own pages show, for when the DESIGN.md API
 * is not configured or fails: its name, colours and fonts in the front
 * matter `brandLookFromDesignMd` reads.
 */
export function siteDesignMd(site: BrandVisual, websiteUrl: string): string {
  const quote = (value: string) => JSON.stringify(value);
  return [
    "---",
    ...(site.siteName ? [`name: ${quote(site.siteName)}`] : []),
    ...(site.colors.length
      ? [
          "colors:",
          ...site.colors.map(
            (color, index) => `  brand-${index + 1}: ${quote(color)}`,
          ),
        ]
      : []),
    ...(site.fonts.length
      ? [
          "typography:",
          ...site.fonts.map(
            (font, index) =>
              `  font-${index + 1}:\n    fontFamily: ${quote(font)}`,
          ),
        ]
      : []),
    "---",
    "",
    `# ${site.siteName ?? new URL(websiteUrl).hostname}`,
    "",
    `The colours and fonts ${websiteUrl} uses, most used first.`,
    ...(site.logoUrl ? ["", `Logo: ${site.logoUrl}`] : []),
    "",
  ].join("\n");
}

const DESIGN_MD_POLL_MS = 3_000;
const DESIGN_MD_BUDGET_MS = 120_000;

/**
 * The site's DESIGN.md from the Masumi DESIGN.md API (the service Web uses).
 * `force` asks for a fresh reading instead of one it kept. Null when the API
 * is not configured or fails.
 */
async function requestDesignMd(
  projectId: string,
  websiteUrl: string,
  force = false,
): Promise<{ designMd: string; extractionId: string | null } | null> {
  const env = getEnv();
  if (!env.MASUMI_DESIGN_MD_API_KEY) return null;
  const { createDesignMdClient } = await import("@sokosumi/masumi/tools");
  const client = createDesignMdClient({
    apiKey: env.MASUMI_DESIGN_MD_API_KEY,
    apiUrl: env.MASUMI_DESIGN_MD_API_URL,
  });
  // The homepage describes the brand; an entered subpage ("/pages/about")
  // named the file after that page.
  let result = await client.submit({
    url: new URL("/", websiteUrl).toString(),
    ...(force ? { force } : {}),
  });
  const deadline = Date.now() + DESIGN_MD_BUDGET_MS;
  while (
    result.isOk() &&
    (result.value.status === "queued" || result.value.status === "running") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, DESIGN_MD_POLL_MS));
    result = await client.pollJob(result.value.jobId);
  }
  if (result.isErr() || result.value.status !== "done") {
    recordCoreWarning(
      { operation: "cmo_brand_visual", project: { id: projectId } },
      {
        message: "Could not generate the brand's DESIGN.md",
        why: result.isErr()
          ? "The DESIGN.md service returned an error"
          : result.value.status === "queued" ||
              result.value.status === "running"
            ? "The DESIGN.md job did not finish in time"
            : "The DESIGN.md job did not succeed",
        fix: "The Brand Brain shows no DESIGN.md; retrying Cuso's onboarding asks again. If it repeats, check the DESIGN.md service with the reason under designMd.",
      },
      {
        designMd: {
          reason: result.isErr() ? result.error.type : result.value.status,
        },
      },
    );
    return null;
  }
  const done = result.value;
  return {
    designMd: done.designMd,
    extractionId: done.extractionId === null ? null : String(done.extractionId),
  };
}

/** The brand's DESIGN.md from the API, stored on the CMO Project. */
async function generateProjectDesignMd(
  projectId: string,
  websiteUrl: string,
): Promise<{ url: string; content: string } | null> {
  const done = await requestDesignMd(projectId, websiteUrl);
  if (!done) return null;
  const stored = await uploadDesignMdContent({
    content: done.designMd,
    owner: { kind: "project", id: projectId },
    extractionId: done.extractionId,
  });
  if (!stored) return null;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      designMdUrl: stored,
      designMdExtractionId: done.extractionId,
    },
  });
  return { url: stored, content: done.designMd };
}

const MAX_LOGO_BYTES = 2_000_000;
const LOGO_TIMEOUT_MS = 10_000;
/** A logo is kept this wide at most; an SVG is drawn at this width. */
const LOGO_WIDTH = 1024;

/**
 * A logo file as a PNG that keeps its transparency: an SVG drawn at
 * `LOGO_WIDTH` however small it declares itself, a bitmap never enlarged.
 * Null for anything that is not one still image.
 */
export async function logoPng(bytes: Buffer): Promise<Buffer | null> {
  try {
    const first = await sharp(bytes, {
      limitInputPixels: 16_000_000,
    }).metadata();
    if ((first.pages ?? 1) !== 1 || !first.width) return null;
    const density =
      first.format === "svg" && first.width < LOGO_WIDTH
        ? Math.min(2400, Math.ceil((72 * LOGO_WIDTH) / first.width))
        : undefined;
    return await sharp(bytes, {
      limitInputPixels: 16_000_000,
      ...(density ? { density } : {}),
    })
      .timeout({ seconds: 4 })
      .resize({
        width: LOGO_WIDTH,
        height: LOGO_WIDTH,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** Whether every visible pixel of a logo is near white. */
async function lightOnly(png: Buffer): Promise<boolean> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let at = 0; at < data.length; at += info.channels) {
    if ((data[at + 3] ?? 0) < 32) continue;
    visible += 1;
    const luminance =
      0.2126 * (data[at] ?? 0) +
      0.7152 * (data[at + 1] ?? 0) +
      0.0722 * (data[at + 2] ?? 0);
    if (luminance < 200) return false;
  }
  return visible > 0;
}

type LogoOwner = Pick<
  Cuso,
  "projectId" | "websiteUrl" | "workspaceId" | "sokoBotId"
>;

/**
 * Saves the logo a DESIGN.md names as the Project's files under "Brand
 * research/Logo": the full logo, its version for a dark background and the
 * square mark, each as a PNG. Returns how many were saved.
 */
export async function saveCmoBrandLogo(
  cuso: LogoOwner,
  designMd: string,
): Promise<number> {
  const logo = designMdLogo(designMd);
  const drive = logo ? await cusoDrive(cuso) : null;
  if (!logo || !drive) return 0;
  let saved = 0;
  for (const [key, name] of Object.entries(CMO_BRAND_LOGO_FILES)) {
    const url = logo[key as keyof typeof CMO_BRAND_LOGO_FILES];
    if (!url) continue;
    const png = await Promise.resolve(
      cmoPathSiteResponse(url) ??
        ssrfSafeFetch(url, {
          signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
          maxResponseBytes: MAX_LOGO_BYTES,
        }),
    )
      .then(async (response) =>
        response.ok ? logoPng(Buffer.from(await response.arrayBuffer())) : null,
      )
      .catch(() => null);
    if (!png) continue;
    // A header logo painted white by the site's CSS comes as a white file,
    // invisible on a light page: it is the version for a dark background.
    let filename = name;
    if (key === "src" && (await lightOnly(png))) {
      if (logo.srcDark) continue;
      filename = CMO_BRAND_LOGO_FILES.srcDark;
    }
    const fileId = await saveCusoProjectFile(
      drive,
      { folder: CMO_BRAND_LOGO_FOLDER, filename: `${filename}.png` },
      png,
      "image/png",
    );
    if (fileId) saved += 1;
  }
  return saved;
}

/**
 * Reads the site's logo again and saves it, for a Cuso whose Project has no
 * logo files: one hired before DESIGN.md named the full logo, or one whose
 * first reading failed. The Project's stored DESIGN.md is left as it is.
 */
export async function refreshCmoBrandLogo(cuso: LogoOwner): Promise<number> {
  const done = await requestDesignMd(cuso.projectId, cuso.websiteUrl, true);
  return done ? saveCmoBrandLogo(cuso, done.designMd) : 0;
}

/**
 * Reads how the brand looks into the Project, where Cuso, CMO and Image
 * Studio read it: the site's best icon as the Project logo, and a DESIGN.md
 * from the API, else one of the site's own colours and fonts.
 */
export async function learnCmoBrandVisual(cuso: LogoOwner): Promise<void> {
  const [site, , designMd] = await Promise.all([
    readBrandVisual(cuso.websiteUrl),
    resolveSiteIconAsProjectLogo(cuso.websiteUrl, cuso.projectId)
      .then(async (logo) => {
        if (logo) {
          await prisma.project.updateMany({
            where: { id: cuso.projectId, logo: null },
            data: { logo, projectRevision: { increment: 1 } },
          });
        }
      })
      .catch(() => null),
    generateProjectDesignMd(cuso.projectId, cuso.websiteUrl).catch(() => null),
  ]);
  if (designMd) {
    // Best effort: the Brand Brain shows the Project's icon without them.
    await saveCmoBrandLogo(cuso, designMd.content).catch(() => 0);
    return;
  }
  if (!site.siteName && site.colors.length === 0 && site.fonts.length === 0)
    return;
  const stored = await uploadDesignMdContent({
    content: siteDesignMd(site, cuso.websiteUrl),
    owner: { kind: "project", id: cuso.projectId },
  });
  if (!stored) return;
  await prisma.project.update({
    where: { id: cuso.projectId },
    data: { designMdUrl: stored, designMdExtractionId: null },
  });
}
