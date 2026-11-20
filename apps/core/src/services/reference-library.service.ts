/**
 * The reference library: old ads, posters, magazine covers, labels and
 * ephemera Cuso takes a style from when he makes a picture. Each image was
 * described once by a vision model (`scripts/reference-library.mts`); Cuso
 * finds one by what his piece is about, and Core makes the picture in that
 * style with the brand's own logo, colours and DESIGN.md.
 */

import type { REFERENCE_KINDS, REFERENCE_PURPOSES } from "@sokosumi/soko-bot";
import { get } from "@vercel/blob";
import { getEnv } from "@/config/env";
import { vectorLiteral } from "@/lib/contacts/embeddings";
import prisma from "@/lib/db/prisma";
import { type EmbedTexts, embedTexts } from "@/lib/embeddings";

/** References below this are blank, damaged or mostly text. */
const MIN_USABLE = 3;
const MAX_RESULTS = 8;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export type ReferencePurpose = (typeof REFERENCE_PURPOSES)[number];

export interface StyleReference {
  id: string;
  kind: string;
  era: string;
  description: string;
  technique: string;
  layout: string;
  lettering: string;
  palette: string[];
  suits: string[];
}

/** Whether pictures can be made in a library style here. */
export function referenceLibraryAvailable(): boolean {
  return Boolean(getEnv().REFERENCE_LIBRARY_READ_WRITE_TOKEN);
}

/** The purposes a picture that shows numbers has: the only ones an infographic suits. */
const INFOGRAPHIC_PURPOSES: readonly ReferencePurpose[] = [
  "data",
  "comparison",
];

/** Whether a picture for this purpose may take an infographic (cmo-v8). */
export function infographicSuits(purpose: ReferencePurpose | undefined) {
  return purpose !== undefined && INFOGRAPHIC_PURPOSES.includes(purpose);
}

/**
 * The library images whose look best fits what the piece is about, by
 * meaning; `kinds` and `purpose` narrow it (an infographic for data, a
 * poster for an event).
 */
export async function findStyleReferences(
  input: {
    about: string;
    kinds?: ReferenceKind[];
    purpose?: ReferencePurpose;
    limit?: number;
    /** References already taken, left out of the results. */
    exclude?: readonly string[];
    /** False leaves infographics out, whatever kinds asks for. */
    infographics?: boolean;
  },
  embed: EmbedTexts = embedTexts,
): Promise<StyleReference[]> {
  const [embedding] = (await embed([input.about])).embeddings;
  if (!embedding) return [];
  const vector = vectorLiteral(embedding);
  const kinds = input.kinds?.length ? input.kinds : null;
  const leftOut = input.infographics === false ? ["infographic"] : [];
  const limit = Math.min(input.limit ?? 5, MAX_RESULTS);
  const exclude = [...(input.exclude ?? [])];
  return prisma.$queryRaw<StyleReference[]>`
    SELECT "id"::text AS id, "kind", "era", "description", "technique",
      "layout", "lettering", "palette", "suits"
    FROM "reference_image"
    WHERE "embedding" IS NOT NULL
      AND "usable" >= ${MIN_USABLE}
      AND (${kinds}::text[] IS NULL OR "kind" = ANY(${kinds}::text[]))
      AND NOT ("kind" = ANY(${leftOut}::text[]))
      AND (${input.purpose ?? null}::text IS NULL OR ${input.purpose ?? null} = ANY("suits"))
      AND NOT ("id"::text = ANY(${exclude}::text[]))
    ORDER BY "embedding" <=> ${vector}::vector
    LIMIT ${limit}
  `;
}

/**
 * The references a Project's approved month already gives its pieces. Each
 * piece takes its own, and the search kept offering taken ones: on NMKR's
 * 171-piece month (2026-11-20) 58 of 381 results were taken, and 8 saves
 * of up to 12 pieces were refused for it.
 */
export async function monthStyleReferenceIds(
  projectId: string,
): Promise<string[]> {
  const approved = await prisma.marketingStrategy.findFirst({
    where: { projectId, approvedAt: { not: null } },
    select: { id: true, plan: true },
  });
  if (!approved) return [];
  const posts = await prisma.socialPost.findMany({
    where: { marketingStrategyId: approved.id, status: { not: "CANCELED" } },
    select: { planning: true },
  });
  const calendar =
    (approved.plan as { calendar?: unknown } | null)?.calendar ?? [];
  const entries = [
    ...posts.map((post) => post.planning),
    ...(Array.isArray(calendar) ? calendar : []),
  ];
  return [
    ...new Set(
      entries.flatMap((entry) => {
        const id = (entry as { styleReferenceId?: unknown } | null)
          ?.styleReferenceId;
        return typeof id === "string" ? [id] : [];
      }),
    ),
  ];
}

/** The image a reference names, as bytes for the image model. */
export async function readReferenceImage(
  id: string,
): Promise<{ bytes: Buffer; contentType: string; description: string } | null> {
  const token = getEnv().REFERENCE_LIBRARY_READ_WRITE_TOKEN;
  if (!token) return null;
  const row = await prisma.referenceImage.findUnique({
    where: { id },
    select: { pathname: true, description: true },
  });
  if (!row) return null;
  const result = await get(row.pathname, { access: "private", token });
  if (!result || result.statusCode !== 200) return null;
  return {
    bytes: Buffer.from(await new Response(result.stream).arrayBuffer()),
    contentType: result.blob.contentType ?? "image/jpeg",
    description: row.description,
  };
}
