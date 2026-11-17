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
import {
  type EmbedTexts,
  embedContactTexts,
  vectorLiteral,
} from "@/lib/contacts/embeddings";
import prisma from "@/lib/db/prisma";

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
  },
  embed: EmbedTexts = embedContactTexts,
): Promise<StyleReference[]> {
  const [embedding] = (await embed([input.about])).embeddings;
  if (!embedding) return [];
  const vector = vectorLiteral(embedding);
  const kinds = input.kinds?.length ? input.kinds : null;
  const limit = Math.min(input.limit ?? 5, MAX_RESULTS);
  return prisma.$queryRaw<StyleReference[]>`
    SELECT "id"::text AS id, "kind", "era", "description", "technique",
      "layout", "lettering", "palette", "suits"
    FROM "reference_image"
    WHERE "embedding" IS NOT NULL
      AND "usable" >= ${MIN_USABLE}
      AND (${kinds}::text[] IS NULL OR "kind" = ANY(${kinds}::text[]))
      AND (${input.purpose ?? null}::text IS NULL OR ${input.purpose ?? null} = ANY("suits"))
    ORDER BY "embedding" <=> ${vector}::vector
    LIMIT ${limit}
  `;
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
