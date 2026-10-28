import { ssrfSafeFetch } from "@sokosumi/net";
import { isDesignMdBlobUrl } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import { parseCmoBrandBrain } from "@/services/brand-brain.service";

/** Enough for colours, type, and voice. The stored job prompt stays the brief. */
const BRAND_BLOCK_MAX_CHARS = 1600;

export interface StudioBrand {
  designMd: string | null;
  memory: string | null;
  /** Who the business is and sounds like, from the Project's Brand Brain. */
  brandBrain: string | null;
}

const NO_BRAND: StudioBrand = {
  designMd: null,
  memory: null,
  brandBrain: null,
};

/**
 * Prefix the fal prompt with the project's Brand Brain, Design and Memory.
 *
 * The job row still stores the person's brief. A missing or unread brand
 * leaves the brief alone (fail open).
 */
export function applyStudioBrandPrompt(
  prompt: string,
  brand: StudioBrand,
): string {
  const design = clipBrandText(brand.designMd);
  const memory = clipBrandText(brand.memory);
  const brandBrain = clipBrandText(brand.brandBrain);
  if (!design && !memory && !brandBrain) return prompt;

  const parts = ["Follow this project's brand."];
  if (brandBrain) parts.push(`Brand Brain:\n${brandBrain}`);
  if (design) parts.push(`Design:\n${design}`);
  if (memory) parts.push(`Memory:\n${memory}`);
  parts.push(`Brief:\n${prompt}`);
  return parts.join("\n\n");
}

export async function loadStudioBrand(projectId: string): Promise<StudioBrand> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        designMdUrl: true,
        contextMd: true,
        brandBrain: { select: { body: true } },
      },
    });
    if (!project) return NO_BRAND;
    return {
      designMd: await readDesignMd(project.designMdUrl),
      memory: clipBrandText(project.contextMd),
      brandBrain: brandBrainText(project.brandBrain?.body),
    };
  } catch {
    return NO_BRAND;
  }
}

/** The Brand Brain lines a picture can follow: its summary, voice, audience and products. */
function brandBrainText(body: unknown): string | null {
  const brain = parseCmoBrandBrain(body);
  if (!brain) return null;
  return clipBrandText(
    [
      brain.summary,
      `Voice: ${brain.voice.tone}`,
      brain.audience.length > 0 ? `Audience: ${brain.audience.join("; ")}` : "",
      brain.products.length > 0 ? `Products: ${brain.products.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function clipBrandText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > BRAND_BLOCK_MAX_CHARS
    ? trimmed.slice(0, BRAND_BLOCK_MAX_CHARS)
    : trimmed;
}

async function readDesignMd(url: string | null): Promise<string | null> {
  if (!url || !isDesignMdBlobUrl(url)) return null;
  try {
    const response = await ssrfSafeFetch(url, {
      maxResponseBytes: LIMITS.DESIGN_MD_MAX_SIZE_BYTES,
    });
    if (!response.ok) return null;
    return clipBrandText(await response.text());
  } catch {
    return null;
  }
}
