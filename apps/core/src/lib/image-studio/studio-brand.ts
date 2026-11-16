import { Prisma } from "@sokosumi/database";
import {
  designMdBrandLook,
  isOwnedProjectLogoUrl,
  normalizeHex,
} from "@sokosumi/utils";
import { DomUtils, parseDocument } from "htmlparser2";

import { badGateway, conflict, unprocessableEntity } from "@/helpers/error";
import { readBrandVisual } from "@/lib/brand-visual";
import prisma from "@/lib/db/prisma";
import { readDesignMdContent } from "@/lib/design-md-blob";
import { importStudioProducts } from "@/lib/image-studio/product-import";
import { suggestWebsiteBrandProfile } from "@/lib/image-studio/website-brand-profile";
import { parseOpenGraphFields } from "@/lib/open-graph-html";
import { resolveStudioWebsiteLogo } from "@/lib/site-icon";
import { readHomepage } from "@/lib/site-platform";
import {
  type SaveStudioBrandLook,
  studioBrandKitSchema,
  studioBrandLookSchema,
  studioBrandLookStateSchema,
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
  look?: NonNullable<SaveStudioBrandLook["look"]>;
}

const NO_BRAND: StudioBrand = {
  designMd: null,
  memory: null,
  brandBrain: null,
};

export function isApprovedStudioHeadline(
  text: string,
  brand: unknown,
): boolean {
  return parseBrandBrain(brand)?.voice.examples.includes(text) ?? false;
}

export function requireApprovedStudioHeadline(text: string, brand: unknown) {
  if (!isApprovedStudioHeadline(text, brand)) {
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
  if (!design && !memory && !brandBrain && !approvedLines && !brand.look)
    return prompt;

  const parts = ["Follow this project's brand."];
  if (brand.look) {
    parts.push(
      "Use these Studio choices for the ad's palette and fonts. They take precedence over any palette or typefaces in the other brand context.",
      `Palette: ${brand.look.colors.join(", ") || "No fixed palette"}`,
      `Fonts: ${brand.look.fonts.join(", ") || "No fixed fonts"}`,
    );
  }
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
        studioBrandLook: true,
        contextMd: true,
        brandBrain: { select: { body: true } },
      },
    });
    if (!project) return NO_BRAND;
    const brain = parseBrandBrain(project.brandBrain?.body);
    const approvedLines = clipBrandText(brain?.voice.examples.join("\n"));
    const look = studioBrandLookSchema.safeParse(project.studioBrandLook);
    return {
      designMd: await readDesignMd(project.designMdUrl),
      memory: clipBrandText(project.contextMd),
      brandBrain: brandBrainText(brain),
      ...(approvedLines ? { approvedLines } : {}),
      ...(look.success ? { look: look.data } : {}),
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
      studioBrandLook: true,
      studioBrandLookRevision: true,
      briefing: true,
      designMdUrl: true,
      brandBrain: { select: { body: true, updatedAt: true } },
    },
  });
  const design = await readDesignMdContent(project.designMdUrl);
  const look = designMdBrandLook(design ?? "");
  const customLook = studioBrandLookSchema.safeParse(project.studioBrandLook);
  const brain = parseBrandBrain(project.brandBrain?.body);
  const logo =
    project.logo && isOwnedProjectLogoUrl(project.logo, projectId)
      ? project.logo
      : null;
  return studioBrandKitSchema.parse({
    logo,
    studioLogoPosition: logo ? (project.studioLogoPosition ?? null) : null,
    colors: customLook.data?.colors ?? look.colors,
    fonts: customLook.data?.fonts ?? look.fonts,
    lookRevision: project.studioBrandLookRevision ?? 0,
    hasCustomLook: customLook.success,
    summary: brain?.summary ?? project.briefing?.slice(0, 2000) ?? "",
    tone: brain?.voice.tone ?? look.tone ?? "",
    audience: brain?.audience ?? [],
    approvedLines: brain?.voice.examples ?? [],
    version: project.brandBrain?.updatedAt?.toISOString() ?? null,
  });
}

export async function saveStudioBrandLook(
  projectId: string,
  workspaceId: string,
  { look, lookRevision }: SaveStudioBrandLook,
) {
  const customLook = look && {
    colors: [
      ...new Set(look.colors.map((color) => normalizeHex(color) ?? color)),
    ],
    fonts: [...new Set(look.fonts)],
  };
  const [project] = await prisma.project.updateManyAndReturn({
    where: {
      id: projectId,
      workspaceId,
      studioBrandLookRevision: lookRevision,
    },
    data: {
      studioBrandLook: customLook ?? Prisma.DbNull,
      studioBrandLookRevision: { increment: 1 },
    },
    select: { designMdUrl: true, studioBrandLookRevision: true },
  });
  if (!project)
    throw conflict(
      "The Studio brand look changed. Reopen Brand Kit and try again.",
    );
  const effective =
    customLook ??
    designMdBrandLook((await readDesignMdContent(project.designMdUrl)) ?? "");
  return studioBrandLookStateSchema.parse({
    colors: effective.colors,
    fonts: effective.fonts,
    lookRevision: project.studioBrandLookRevision,
    hasCustomLook: customLook !== null,
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
  const [brandCopy, products, visual] = await Promise.allSettled([
    readWebsiteCopy(websiteUrl, profileWorkspaceId),
    importStudioProducts(websiteUrl, profileWorkspaceId).then((found) =>
      studioProductImportSchema.parse({ products: found }),
    ),
    profileWorkspaceId
      ? prepareStudioWebsiteVisual(websiteUrl, projectId)
      : undefined,
  ]);
  return studioWebsiteDraftSchema.parse({
    brandCopy: brandCopy.status === "fulfilled" ? brandCopy.value : null,
    products: products.status === "fulfilled" ? products.value.products : null,
    ...(profileWorkspaceId
      ? { visual: visual.status === "fulfilled" ? visual.value : null }
      : {}),
  });
}

async function prepareStudioWebsiteVisual(
  websiteUrl: string,
  projectId: string,
) {
  const [look, logo] = await Promise.allSettled([
    readBrandVisual(websiteUrl, { includeDeclaredNeutrals: true }),
    resolveStudioWebsiteLogo(websiteUrl, projectId),
  ]);
  const colors = look.status === "fulfilled" ? look.value.colors : [];
  const fonts =
    look.status === "fulfilled"
      ? look.value.fonts.filter((font) => font.length <= 80)
      : [];
  const candidate = logo.status === "fulfilled" ? logo.value : null;
  return candidate || colors.length || fonts.length
    ? { colors, fonts, logo: candidate }
    : null;
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
