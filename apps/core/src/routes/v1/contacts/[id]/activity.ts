import { createRoute, z } from "@hono/zod-openapi";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactActivitySchema } from "@/schemas/contact.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { listContactActivity } from "@/services/contacts.service";
import { contactActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/activity",
    tags: ["Contacts"],
    description:
      "Who changed what on a contact, newest first: a person, or a Soko Bot and the member it acted for.",
    request: {
      params: z.object({ id: z.uuid() }),
      query: cursorPaginationQuerySchema.extend({
        cursor: z.uuid().optional(),
      }),
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(contactActivitySchema),
        "Activity",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      422: jsonErrorResponse("Invalid input"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const query = c.req.valid("query");
    const page = await listContactActivity(
      actor,
      c.req.valid("param").id,
      query,
    );
    return ok(c, z.array(contactActivitySchema).parse(page.items), {
      cursor: query.cursor ?? null,
      limit: query.limit,
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
}
