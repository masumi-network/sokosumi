import type { Prisma } from "@sokosumi/database";
import { parseTaskRef } from "@sokosumi/utils";
import { escapeLikeText } from "@/helpers/query-params";
import prisma from "@/lib/db/prisma";
import { resolveTaskRefToId } from "./task-ref";

type ReadPage<Row> = (
  where: Prisma.TaskWhereInput,
  take: number,
  cursor?: string,
) => Promise<Row[]>;

/** Read the chosen sort within each rank, including when a page spans ranks. */
export async function searchTaskList<Row>({
  search,
  workspaceId,
  where,
  take,
  cursor,
  readPage,
}: {
  search: string;
  workspaceId?: string;
  where: Prisma.TaskWhereInput;
  take: number;
  cursor?: string;
  readPage: ReadPage<Row>;
}): Promise<[Row[], number]> {
  const text = {
    contains: escapeLikeText(search),
    mode: "insensitive",
  } as const;
  const ref = parseTaskRef(search);
  const primaryMatches: Prisma.TaskWhereInput[] = [{ name: text }];
  if (ref?.kind === "id") primaryMatches.push({ id: ref.id.toLowerCase() });
  if (ref?.kind === "identifier") {
    if (workspaceId) {
      // A current identifier, retired prefix or former number finds the same
      // Task as its URL. The list's access predicate still applies.
      const id = await resolveTaskRefToId(search, workspaceId, prisma);
      if (id !== search) primaryMatches.push({ id });
    } else {
      primaryMatches.push({
        projectId: { not: null },
        number: { equals: ref.number, not: null },
        project: { identifier: ref.prefix },
      });
    }
  }

  const primary = { OR: primaryMatches };
  const secondary: Prisma.TaskWhereInput = {
    OR: [
      { description: text },
      { workspaceTags: { some: { label: { displayName: text } } } },
      { visibleTopics: { some: { topicId: text } } },
    ],
  };
  const first = { AND: [where, primary] };
  const second = { AND: [where, secondary, { NOT: primary }] };
  async function readMatches() {
    if (cursor) {
      const firstRankCursor = await prisma.task.findFirst({
        where: { AND: [first, { id: cursor }] },
        select: { id: true },
      });
      if (!firstRankCursor) return readPage(second, take, cursor);
    }
    const rows = await readPage(first, take, cursor);
    if (rows.length === take) return rows;
    return rows.concat(await readPage(second, take - rows.length));
  }

  return Promise.all([
    readMatches(),
    prisma.task.count({
      where: { AND: [where, { OR: [primary, secondary] }] },
    }),
  ]);
}
