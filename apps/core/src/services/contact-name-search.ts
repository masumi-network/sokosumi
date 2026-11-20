import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { literalSubstringPattern } from "@/helpers/project-activity";
import { escapeLikeText } from "@/helpers/query-params";
import prisma from "@/lib/db/prisma";

interface ContactPage<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

/** Name hits come first across pages. Each group keeps the reader's sort, including private scores. */
export async function readNameMatchesFirst<T extends { id: string }>(
  scope: Prisma.ContactWhereInput,
  search: string,
  { cursor, limit }: { cursor?: string; limit: number },
  read: (
    where: Prisma.ContactWhereInput,
    cursor: string | undefined,
    limit: number,
  ) => Promise<ContactPage<T>>,
): Promise<ContactPage<T>> {
  const name: Prisma.ContactWhereInput = {
    name: { contains: escapeLikeText(search), mode: "insensitive" },
  };
  const primary = { AND: [scope, name] };
  const secondary = { AND: [scope, { NOT: name }] };
  if (
    cursor &&
    !(await prisma.contact.findFirst({
      where: { ...primary, id: cursor },
      select: { id: true },
    }))
  ) {
    const [totalPrimary, page] = await Promise.all([
      prisma.contact.count({ where: primary }),
      read(secondary, cursor, limit),
    ]);
    return { ...page, total: totalPrimary + page.total };
  }
  const first = await read(primary, cursor, limit);
  if (first.items.length === limit) {
    const totalSecondary = await prisma.contact.count({ where: secondary });
    return {
      ...first,
      total: first.total + totalSecondary,
      nextCursor:
        first.nextCursor ??
        (totalSecondary ? (first.items.at(-1)?.id ?? null) : null),
    };
  }
  const rest = await read(secondary, undefined, limit - first.items.length);
  return {
    items: [...first.items, ...rest.items],
    total: first.total + rest.total,
    nextCursor: rest.nextCursor,
  };
}

/**
 * Contacts whose location holds `search`, ignoring case and accents, so
 * "zurich" finds "Zürich". Prisma's `contains` cannot unaccent, so plain
 * matches stay a column predicate and only places that need the accents
 * folded are looked up: as their distinct spellings, not one id per contact.
 */
async function locationSearchWhere(
  workspaceId: string,
  search: string,
  maxFilterIds: number,
): Promise<Prisma.ContactWhereInput> {
  const pattern = literalSubstringPattern(search);
  const rows = await prisma.$queryRaw<{ location: string }[]>(PrismaRaw.sql`
    SELECT DISTINCT "location" FROM "contact"
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND "mergedIntoId" IS NULL
      AND unaccent("location") ILIKE unaccent(${pattern}) ESCAPE '\\'
      AND "location" NOT ILIKE ${pattern} ESCAPE '\\'
    LIMIT ${maxFilterIds + 1}`);
  const plain: Prisma.ContactWhereInput = {
    location: { contains: escapeLikeText(search), mode: "insensitive" },
  };
  if (!rows.length) return plain;
  return { OR: [plain, { location: { in: rows.map((row) => row.location) } }] };
}

export async function contactSearchWhere(
  workspaceId: string,
  text: string,
  maxFilterIds: number,
): Promise<Prisma.ContactWhereInput> {
  const search = escapeLikeText(text);
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { organization: { contains: search, mode: "insensitive" } },
      { role: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
      {
        channels: {
          some: { value: { contains: search, mode: "insensitive" } },
        },
      },
      await locationSearchWhere(workspaceId, text, maxFilterIds),
    ],
  };
}
