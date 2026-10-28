import { getEnv } from "@/config/env";
import {
  type BrandVisual,
  brandColors,
  brandFontName,
  readBrandVisual,
} from "@/lib/brand-visual";
import prisma from "@/lib/db/prisma";
import {
  readDesignMdContent,
  uploadDesignMdContent,
} from "@/lib/design-md-blob";
import { decodeEntities } from "@/lib/open-graph-html";
import { resolveSiteIconAsProjectLogo } from "@/lib/site-icon";
import type { Cuso } from "@/services/cmo-cuso.service";

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
 * `fontFamily` entries (CSS `font-family` too), and its colours, most used
 * first.
 */
export function brandLookFromDesignMd(
  content: string,
): Pick<CmoBrandVisual, "colors" | "fonts" | "siteName"> {
  const name = content
    .match(/^---\n[\s\S]*?^name:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  const fonts = [
    ...content.matchAll(/font-?family["']?\s*:\s*["']?([^"',;\n]+)/gi),
  ]
    .map((match) => brandFontName(match[1] ?? ""))
    .filter((font): font is string => font !== null);
  return {
    colors: brandColors(content, 5),
    fonts: [...new Set(fonts)].slice(0, 4),
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
 * The brand's DESIGN.md from the Masumi DESIGN.md API (the service Web uses),
 * stored on the CMO Project. Null when the API is not configured or fails.
 */
async function generateProjectDesignMd(
  projectId: string,
  websiteUrl: string,
): Promise<{ url: string; content: string } | null> {
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
    console.warn("CMO DESIGN.md not generated", {
      projectId,
      reason: result.isErr() ? result.error.type : result.value.status,
    });
    return null;
  }
  const done = result.value;
  const extractionId =
    done.extractionId === null ? null : String(done.extractionId);
  const stored = await uploadDesignMdContent({
    content: done.designMd,
    owner: { kind: "project", id: projectId },
    extractionId,
  });
  if (!stored) return null;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      designMdUrl: stored,
      designMdExtractionId: extractionId,
    },
  });
  return { url: stored, content: done.designMd };
}

/**
 * Reads how the brand looks into the Project, where Cuso, CMO and Image
 * Studio read it: the site's best icon as the Project logo, and a DESIGN.md
 * from the API, else one of the site's own colours and fonts.
 */
export async function learnCmoBrandVisual(
  hire: Pick<Cuso, "projectId" | "websiteUrl">,
): Promise<void> {
  const [site, , designMd] = await Promise.all([
    readBrandVisual(hire.websiteUrl),
    resolveSiteIconAsProjectLogo(hire.websiteUrl, hire.projectId)
      .then(async (logo) => {
        if (logo) {
          await prisma.project.update({
            where: { id: hire.projectId },
            data: { logo },
          });
        }
      })
      .catch(() => null),
    generateProjectDesignMd(hire.projectId, hire.websiteUrl).catch(() => null),
  ]);
  if (designMd) return;
  if (!site.siteName && site.colors.length === 0 && site.fonts.length === 0)
    return;
  const stored = await uploadDesignMdContent({
    content: siteDesignMd(site, hire.websiteUrl),
    owner: { kind: "project", id: hire.projectId },
  });
  if (!stored) return;
  await prisma.project.update({
    where: { id: hire.projectId },
    data: { designMdUrl: stored, designMdExtractionId: null },
  });
}
