import { type Prisma, TaskStatus } from "@sokosumi/database";
import { parseTaskRef } from "@sokosumi/utils";
import { plainExcerpt } from "@/helpers/job-digest";
import { escapeLikeText } from "@/helpers/query-params";
import prisma from "@/lib/db/prisma";
import { resolveTaskRefToId } from "./task-ref";

type ReadPage<Row> = (
  where: Prisma.TaskWhereInput,
  take: number,
  cursor?: string,
) => Promise<Row[]>;

const RESULT_MATCH_LENGTH = 160;
// Short, so the match shows within a card's two lines and a list row's one.
const RESULT_MATCH_LEAD = 20;
const RESULT_MATCH_WORD_SNAP = 12;

/**
 * Text around the first match, so a hit found only in a result shows why.
 * Plain text when the match survives removing Markdown; the raw text when
 * it sat in markup (a link target, a code block), so it stays in view.
 */
export function resultMatchExcerpt(comment: string, search: string): string {
  const needle = search.toLowerCase();
  const stripped = plainExcerpt(comment, Number.POSITIVE_INFINITY);
  const plain = (
    stripped.toLowerCase().includes(needle) ? stripped : comment
  ).replace(/\s+/g, " ");
  const at = plain.toLowerCase().indexOf(needle);
  let start = Math.max(0, at - RESULT_MATCH_LEAD);
  // Begin at the start of a word, unless that word is long (a link).
  const wordStart = plain.lastIndexOf(" ", start) + 1;
  if (start - wordStart <= RESULT_MATCH_WORD_SNAP) start = wordStart;
  const end = start + RESULT_MATCH_LENGTH;
  return `${start > 0 ? "…" : ""}${plain.slice(start, end).trim()}${end < plain.length ? "…" : ""}`;
}

/**
 * Read the chosen sort within each rank, including when a page spans ranks:
 * name or identifier, then tag or description, then a done comment (the
 * result). Rows found only by their result come with an excerpt.
 */
export async function searchTaskList<Row extends { id: string }>({
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
}): Promise<[Row[], number, Map<string, string>]> {
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
      // `not: null` keeps a later rank's NOT true for a Task without a
      // brief: in SQL, NOT of a match on NULL is NULL and drops the row.
      { description: { ...text, not: null } },
      { workspaceTags: { some: { label: { displayName: text } } } },
      { visibleTopics: { some: { topicId: text } } },
    ],
  };
  const result: Prisma.TaskWhereInput = {
    events: { some: { status: TaskStatus.COMPLETED, comment: text } },
  };
  const ranks = [primary, secondary, result].map(
    (match, rank, matches): Prisma.TaskWhereInput => ({
      AND: [
        where,
        match,
        ...matches.slice(0, rank).map((earlier) => ({ NOT: earlier })),
      ],
    }),
  );
  const resultRank = ranks.length - 1;
  const resultIds = new Set<string>();
  async function readMatches() {
    let rank = 0;
    if (cursor) {
      while (
        rank < resultRank &&
        !(await prisma.task.findFirst({
          where: { AND: [ranks[rank], { id: cursor }] },
          select: { id: true },
        }))
      )
        rank++;
    }
    const rows: Row[] = [];
    for (let at = rank; at < ranks.length && rows.length < take; at++) {
      const page = await readPage(
        ranks[at],
        take - rows.length,
        at === rank ? cursor : undefined,
      );
      if (at === resultRank) for (const row of page) resultIds.add(row.id);
      rows.push(...page);
    }
    return rows;
  }
  async function readResultMatches() {
    const matches = new Map<string, string>();
    if (resultIds.size === 0) return matches;
    const events = await prisma.taskEvent.findMany({
      where: {
        taskId: { in: [...resultIds] },
        status: TaskStatus.COMPLETED,
        comment: text,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { taskId: true, comment: true },
    });
    for (const { taskId, comment } of events)
      if (comment && !matches.has(taskId))
        matches.set(taskId, resultMatchExcerpt(comment, search));
    return matches;
  }

  const [rows, count] = await Promise.all([
    readMatches(),
    prisma.task.count({
      where: { AND: [where, { OR: [primary, secondary, result] }] },
    }),
  ]);
  return [rows, count, await readResultMatches()];
}
