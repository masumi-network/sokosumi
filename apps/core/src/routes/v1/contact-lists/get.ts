import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListSchema } from "@/schemas/contact.schema";
import { listContactLists } from "@/services/contact-lists.service";
import { contactActor } from "../contacts/context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Contact lists"],
    description:
      "Every contact list in the workspace with its live count. Smart lists (`kind: smart`) are saved filters; read their contacts with `GET /contacts?listId=`.",
    responses: {
      200: jsonSuccessResponse(z.array(contactListSchema), "Lists"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      z.array(contactListSchema).parse(await listContactLists(actor)),
    );
  });
}
