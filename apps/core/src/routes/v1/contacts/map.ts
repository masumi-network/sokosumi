import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contactListQuerySchema,
  contactMapSchema,
} from "@/schemas/contact.schema";
import { contactMap } from "@/services/contact-map.service";
import { contactActor, contactQueryOptions } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/map",
    tags: ["Contacts"],
    description:
      "The contacts the list query matches, grouped by where their location places them on a map. Takes the same filters as `GET /contacts`; `cursor`, `limit` and `sort` are ignored. New places are looked up on the way, so a first load can take a few seconds.",
    request: { query: contactListQuerySchema },
    responses: {
      200: jsonSuccessResponse(contactMapSchema, "Contacts by place"),
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
    const options = contactQueryOptions(c.req.valid("query"));
    return ok(c, await contactMap(actor, options));
  });
}
