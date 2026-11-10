import { designMdBrandLook, isOwnedProjectLogoUrl } from "@sokosumi/utils";
import { DomUtils, parseDocument } from "htmlparser2";

import { badGateway, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { readDesignMdContent } from "@/lib/design-md-blob";
import { importStudioProducts } from "@/lib/image-studio/product-import";
import { suggestWebsiteBrandProfile } from "@/lib/image-studio/website-brand-profile";
import { parseOpenGraphFields } from "@/lib/open-graph-html";
import { readHomepage } from "@/lib/site-platform";
import {
  studioBrandKitSchema,
  studioWebsiteCopySchema,
  studioWebsiteDraftSchema,
} from "@/schemas/studio-brand-kit.schema";
import { studioProductImportSchema } from "@/schemas/studio-product.schema";
import { parseBrandBrain } from "@/services/brand-brain.service";

/** Enough for colours, type, and voice. The stored job prompt stays the brief. */
const BRAND_BLOCK_MAX_CHARS = 1600;

export interface StudioBrand {
  designMd: string | null;
  memory: string | null;
  /** Who the business is and sounds like, from the Project's Brand Brain. */
  brandBrain: string | null;
  approvedLines?: string;
}

const NO_BRAND: StudioBrand = {
  designMd: null,
  memory: null,
  brandBrain: null,
};

export function requireApprovedStudioHeadline(text: string, brand: unknown) {
  if (!parseBrandBrain(brand)?.voice.examples.includes(text)) {
    throw unprocessableEntity("Headline is no longer approved in Brand Kit", {
      kind: "studio_headline_not_approved",
    });
  }
}

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
  const approvedLines = clipBrandText(brand.approvedLines);
  if (!design && !memory && !brandBrain && !approvedLines) return prompt;

  const parts = ["Follow this project's brand."];
  if (approvedLines) {
    parts.push(`Approved ad copy (use where relevant):\n${approvedLines}`);
  }
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
    const brain = parseBrandBrain(project.brandBrain?.body);
    const approvedLines = clipBrandText(brain?.voice.examples.join("\n"));
    return {
      designMd: await readDesignMd(project.designMdUrl),
      memory: clipBrandText(project.contextMd),
      brandBrain: brandBrainText(brain),
      ...(approvedLines ? { approvedLines } : {}),
    };
  } catch {
    return NO_BRAND;
  }
}

export async function readStudioBrandKit(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      logo: true,
      studioLogoPosition: true,
      briefing: true,
      designMdUrl: true,
      brandBrain: { select: { body: true, updatedAt: true } },
    },
  });
  const design = await readDesignMdContent(project.designMdUrl);
  const look = designMdBrandLook(design ?? "");
  const brain = parseBrandBrain(project.brandBrain?.body);
  const logo =
    project.logo && isOwnedProjectLogoUrl(project.logo, projectId)
      ? project.logo
      : null;
  return studioBrandKitSchema.parse({
    logo,
    studioLogoPosition: logo ? (project.studioLogoPosition ?? null) : null,
    colors: look.colors,
    fonts: look.fonts,
    summary: brain?.summary ?? project.briefing?.slice(0, 2000) ?? "",
    tone: brain?.voice.tone ?? look.tone ?? "",
    audience: brain?.audience ?? [],
    approvedLines: brain?.voice.examples ?? [],
    version: project.brandBrain?.updatedAt?.toISOString() ?? null,
  });
}

export async function readStudioWebsiteCopy(projectId: string) {
  return readWebsiteCopy(await studioWebsiteUrl(projectId));
}

export async function prepareStudioWebsiteDraft(
  projectId: string,
  profileWorkspaceId?: string,
) {
  const websiteUrl = await studioWebsiteUrl(projectId);
  const [brandCopy, products] = await Promise.allSettled([
    readWebsiteCopy(websiteUrl, profileWorkspaceId),
    importStudioProducts(websiteUrl).then((found) =>
      studioProductImportSchema.parse({ products: found }),
    ),
  ]);
  return studioWebsiteDraftSchema.parse({
    brandCopy: brandCopy.status === "fulfilled" ? brandCopy.value : null,
    products: products.status === "fulfilled" ? products.value.products : null,
  });
}

async function studioWebsiteUrl(projectId: string) {
  const { websiteUrl } = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { websiteUrl: true },
  });
  if (!websiteUrl) throw unprocessableEntity("Set a project website first");
  return websiteUrl;
}

async function readWebsiteCopy(
  websiteUrl: string,
  profileWorkspaceId?: string,
) {
  const page = await readHomepage(websiteUrl);
  const contentType = page?.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    !page ||
    (contentType !== "text/html" && contentType !== "application/xhtml+xml")
  ) {
    throw badGateway("Could not read the project website");
  }

  const html = page.html.slice(0, 512 * 1024);
  const document = parseDocument(html);
  const description = DomUtils.getElementsByTagName(
    "meta",
    document.children,
  ).find((tag) => tag.attribs.name?.toLowerCase() === "description")?.attribs
    .content;
  const summary = websiteCopyLine(
    parseOpenGraphFields(html).description ?? description,
  );
  const main = DomUtils.getElementsByTagName("main", document.children)[0];
  const headlines = DomUtils.getElementsByTagName(
    (name) => name === "h1" || name === "h2",
    main?.children ?? document.children,
  );
  const lines = [
    ...new Set(
      headlines
        .map((heading) => websiteCopyLine(DomUtils.textContent(heading)))
        .filter((line): line is string => line !== null && line !== summary),
    ),
  ].slice(0, 4);
  const profile = profileWorkspaceId
    ? await suggestWebsiteBrandProfile(
        profileWorkspaceId,
        [
          summary,
          ...lines,
          ...DomUtils.getElementsByTagName(
            "p",
            main?.children ?? document.children,
            true,
            24,
          ).map((paragraph) =>
            websiteCopyLine(DomUtils.textContent(paragraph)),
          ),
        ]
          .filter(Boolean)
          .join("\n"),
      )
    : {};
  return studioWebsiteCopySchema.parse({ summary, lines, ...profile });
}

function websiteCopyLine(value: string | undefined | null): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text && text.length <= 2_000 ? text : null;
}

/** The Brand Brain lines a picture can follow: its summary, voice, audience and products. */
function brandBrainText(
  brain: ReturnType<typeof parseBrandBrain>,
): string | null {
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
  const content = (await readDesignMdContent(url))?.trim();
  if (!content || content.length <= BRAND_BLOCK_MAX_CHARS) {
    return content || null;
  }
  const { colors, fonts } = designMdBrandLook(content);
  return clipBrandText(
    [
      colors.length ? `Brand colors: ${colors.join(", ")}` : "",
      fonts.length ? `Brand fonts: ${fonts.join(", ")}` : "",
      content,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
