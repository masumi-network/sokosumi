import type { Prisma } from "@sokosumi/database";
import type { TableActor } from "@/helpers/data-table";
import { unprocessableEntity } from "@/helpers/error";
import { escapeLikeText } from "@/helpers/query-params";
import prisma from "@/lib/db/prisma";
import { dataTableSummarySchema } from "@/schemas/data-table.schema";

export interface DataTableListOptions {
  cursor?: string;
  limit?: number;
  archived?: boolean;
  projectId?: string;
  search?: string;
}

export async function readDataTablePage(
  actor: TableActor,
  options: DataTableListOptions,
  tableId?: string,
) {
  const limit = Math.min(options.limit ?? 50, 100);
  const search = options.search?.trim();
  const titleMatch = {
    title: { contains: escapeLikeText(search ?? ""), mode: "insensitive" },
  } satisfies Prisma.DataTableWhereInput;
  const where: Prisma.DataTableWhereInput = {
    workspaceId: actor.workspaceId,
    ...(tableId ? { id: tableId } : {}),
    archivedAt: options.archived ? { not: null } : null,
    ...((actor.projectScope ?? options.projectId)
      ? { projectId: actor.projectScope ?? options.projectId }
      : {}),
    ...(search
      ? {
          OR: [
            titleMatch,
            {
              description: {
                contains: escapeLikeText(search),
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };
  const cursor = options.cursor
    ? await prisma.dataTable.findFirst({
        where: { id: options.cursor, workspaceId: actor.workspaceId },
        select: { id: true, updatedAt: true },
      })
    : null;
  if (options.cursor && !cursor)
    throw unprocessableEntity("Invalid table cursor");
  function fetchRows(
    group: Prisma.DataTableWhereInput,
    take: number,
    after: typeof cursor,
  ) {
    return prisma.dataTable.findMany({
      where: {
        AND: [
          where,
          group,
          ...(after
            ? [
                {
                  OR: [
                    { updatedAt: { lt: after.updatedAt } },
                    { updatedAt: after.updatedAt, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take,
      include: { _count: { select: { columns: true } } },
    });
  }
  async function readPage() {
    const take = limit + 1;
    if (!search) return fetchRows({}, take, cursor);
    const secondary = { NOT: titleMatch };
    if (
      cursor &&
      !(await prisma.dataTable.findFirst({
        where: { AND: [where, titleMatch], id: cursor.id },
        select: { id: true },
      }))
    )
      return fetchRows(secondary, take, cursor);
    const first = await fetchRows(titleMatch, take, cursor);
    return first.length === take
      ? first
      : first.concat(await fetchRows(secondary, take - first.length, null));
  }
  const [tables, total] = await Promise.all([
    readPage(),
    prisma.dataTable.count({ where }),
  ]);
  return {
    total,
    items: tables
      .slice(0, limit)
      .map(({ _count, ...table }) =>
        dataTableSummarySchema.parse({ ...table, columnCount: _count.columns }),
      ),
    nextCursor: tables.length > limit ? tables[limit - 1].id : null,
  };
}
