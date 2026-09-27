import { createRoute, z } from "@hono/zod-openapi";
import { requireDataTable } from "@/helpers/data-table";
import { forbidden, notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { tableChangeSchema, tableRowSchema } from "@/schemas/data-table.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { tableActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/history",
    tags: ["Tables"],
    request: {
      headers: z.object({
        "X-Table-Task-Id": z.string().max(200).optional().openapi({
          description:
            "Assigned task context. Required for direct coworker and Soko Bot table operations; enforces persisted selected-row scope.",
        }),
      }),
      params: z.object({ id: z.uuid() }),
      query: cursorPaginationQuerySchema.extend({
        cursor: z.uuid().optional(),
        rowId: z.uuid().optional(),
        columnId: z.uuid().optional(),
      }),
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(tableChangeSchema),
        "Table operation completed",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Invalid table input"),
    },
  }),
);
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await tableActor(c);
    if (actor.actorKind !== "user")
      throw forbidden("History is available to people only");
    const { id } = c.req.valid("param");
    await requireDataTable(actor, id);
    const query = c.req.valid("query");
    if (
      query.cursor &&
      !(await prisma.tableChange.findFirst({
        where: { id: query.cursor, tableId: id },
        select: { id: true },
      }))
    )
      throw notFound("History cursor not found");
    const where = {
      tableId: id,
      rowId: query.rowId,
      ...(query.columnId
        ? { OR: [{ columnId: query.columnId }, { columnId: null }] }
        : {}),
    };
    const total = await prisma.tableChange.count({ where });
    const items = await prisma.tableChange.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { sequence: "desc" },
      take: query.limit + 1,
    });
    const page = items.slice(0, query.limit);
    const actorIds = [...new Set(page.map((item) => item.actorId))];
    const [users, bots, coworkers] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      }),
      prisma.sokoBot.findMany({
        where: {
          id: { in: actorIds.filter((id) => z.uuid().safeParse(id).success) },
        },
        select: { id: true, name: true },
      }),
      prisma.coworker.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(
      [...users, ...bots, ...coworkers].map((actor) => [actor.id, actor.name]),
    );
    return ok(
      c,
      page.map((item) => {
        const mapped = tableChangeSchema.parse({
          ...item,
          actorName: names.get(item.actorId) ?? null,
        });
        if (query.columnId && !item.columnId) {
          const envelope = z.object({ value: z.unknown() }).parse(item.after);
          const inserted = tableRowSchema.safeParse(envelope.value);
          if (inserted.success) {
            mapped.after = {
              value: inserted.data.values[query.columnId] ?? null,
            };
            mapped.before = { value: null };
            mapped.evidence = inserted.data.evidence[query.columnId] ?? [];
          }
        }
        return mapped;
      }),
      {
        cursor: query.cursor ?? null,
        limit: query.limit,
        total,
        nextCursor:
          items.length > query.limit ? items[query.limit - 1].id : null,
      },
    );
  });
}
