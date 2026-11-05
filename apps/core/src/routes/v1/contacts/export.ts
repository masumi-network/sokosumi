import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListQuerySchema } from "@/schemas/contact.schema";
import { exportContactsCsv } from "@/services/contacts-import.service";
import { contactActor, contactQueryOptions } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/export.csv",
    tags: ["Contacts"],
    description:
      "Every contact the list query matches (up to 10,000), as CSV. Takes the same filters as `GET /contacts`; `cursor` and `limit` are ignored.",
    request: { query: contactListQuerySchema },
    responses: {
      200: {
        description: "Contacts as CSV",
        content: { "text/csv": { schema: { type: "string" } } },
      },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("List not found"),
      422: jsonErrorResponse("Invalid query"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const csv = await exportContactsCsv(
      actor,
      contactQueryOptions(c.req.valid("query")),
    );
    const day = new Date().toISOString().slice(0, 10);
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contacts-${day}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });
}
