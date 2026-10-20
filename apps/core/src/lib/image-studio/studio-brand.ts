import { ssrfSafeFetch } from "@sokosumi/net";
import { isDesignMdBlobUrl } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import prisma from "@/lib/db/prisma";

/** Enough for colours, type, and voice. The stored job prompt stays the brief. */
const BRAND_BLOCK_MAX_CHARS = 1600;

export interface StudioBrand {
  designMd: string | null;
  memory: string | null;
}

/**
 * Prefix the fal prompt with the project's Design and Memory.
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
  if (!design && !memory) return prompt;

  const parts = ["Follow this project's brand."];
  if (design) parts.push(`Design:\n${design}`);
  if (memory) parts.push(`Memory:\n${memory}`);
  parts.push(`Brief:\n${prompt}`);
  return parts.join("\n\n");
}

export async function loadStudioBrand(projectId: string): Promise<StudioBrand> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { designMdUrl: true, contextMd: true },
    });
    if (!project) return { designMd: null, memory: null };
    return {
      designMd: await readDesignMd(project.designMdUrl),
      memory: clipBrandText(project.contextMd),
    };
  } catch {
    return { designMd: null, memory: null };
  }
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
