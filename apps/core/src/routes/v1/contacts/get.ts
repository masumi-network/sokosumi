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
import {
  contactListQuerySchema,
  contactSchema,
} from "@/schemas/contact.schema";
import { listContacts } from "@/services/contacts.service";
import { contactActor, contactQueryOptions } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Contacts"],
    description:
      "Contacts in the active workspace, filtered and sorted, with the total match count in the pagination meta. `listId` works for manual and smart lists.",
    request: { query: contactListQuerySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(z.array(contactSchema), "Contacts"),
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
    const query = c.req.valid("query");
    const page = await listContacts(actor, {
      ...contactQueryOptions(query),
      cursor: query.cursor,
      limit: query.limit,
    });
    return ok(c, z.array(contactSchema).parse(page.items), {
      cursor: query.cursor ?? null,
      limit: query.limit,
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
}
