import { z } from "zod";
import { getEnv } from "@/config/env";
import {
  type BrandVisual,
  brandColors,
  brandFontName,
  distinctColors,
  readBrandVisual,
} from "@/lib/brand-visual";
import prisma from "@/lib/db/prisma";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import { decodeEntities } from "@/lib/open-graph-html";
import { resolveSiteIconAsProjectLogo } from "@/lib/site-icon";
import { type CmoHireView } from "@/services/cmo-cuso.service";

export const cmoBrandVisualSchema = z.object({
  logoUrl: z.string().url().nullable(),
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).max(8),
  fonts: z.array(z.string().max(80)).max(4),
  siteName: z.string().max(120).nullable(),
  designMdUrl: z.string().url().nullable(),
  images: z.array(z.string().url()).max(8).default([]),
});
export type CmoBrandVisual = z.infer<typeof cmoBrandVisualSchema>;

export function parseCmoBrandVisual(value: unknown): CmoBrandVisual | null {
  const parsed = cmoBrandVisualSchema.safeParse(value);
  if (!parsed.success) return null;
  // Rows saved before the filters tightened still carry fallbacks, icon
  // fonts, near-repeat colours and raw entities.
  const fonts = parsed.data.fonts
    .map(brandFontName)
    .filter((font): font is string => font !== null);
  return {
    ...parsed.data,
    colors: distinctColors(parsed.data.colors),
    fonts: [...new Set(fonts)],
    siteName: parsed.data.siteName
      ? decodeEntities(parsed.data.siteName)
      : null,
  };
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
 * Reads how the brand looks and keeps it on the CMO hire: the logo (the
 * site's own, else its best icon stored as the Project logo), colours, fonts
 * and, when the API is configured, a DESIGN.md on the Project.
 */
export async function learnCmoBrandVisual(
  hire: Pick<CmoHireView, "id" | "projectId" | "websiteUrl">,
): Promise<CmoBrandVisual> {
  const [site, icon, designMd] = await Promise.all([
    readBrandVisual(hire.websiteUrl),
    resolveSiteIconAsProjectLogo(hire.websiteUrl, hire.projectId)
      .then(async (logo) => {
        if (logo) {
          await prisma.project.update({
            where: { id: hire.projectId },
            data: { logo },
          });
        }
        return logo;
      })
      .catch(() => null),
    generateProjectDesignMd(hire.projectId, hire.websiteUrl).catch(() => null),
  ]);
  const visual = mergeBrandVisual(site, icon, designMd);
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { brandVisual: visual },
  });
  return visual;
}

/** The DESIGN.md's colours lead when there is one; the site fills the rest. */
export function mergeBrandVisual(
  site: BrandVisual,
  iconUrl: string | null,
  designMd: { url: string; content: string } | null,
): CmoBrandVisual {
  const designColors = designMd ? brandColors(designMd.content, 5) : [];
  return {
    logoUrl: site.logoUrl ?? iconUrl,
    colors: distinctColors([...designColors, ...site.colors]).slice(0, 5),
    fonts: site.fonts,
    siteName: site.siteName,
    designMdUrl: designMd?.url ?? null,
    images: site.images,
  };
}
