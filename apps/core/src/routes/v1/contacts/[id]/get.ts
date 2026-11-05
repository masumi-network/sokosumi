import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactDetailSchema } from "@/schemas/contact.schema";
import { getContactDetail } from "@/services/contacts.service";
import { contactActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["Contacts"],
    description:
      "One contact with its channels, lists, who on the team knows them, the ten latest interactions and merge suggestions. A merged contact answers with `mergedIntoId` set.",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: jsonSuccessResponse(contactDetailSchema, "Contact"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      422: jsonErrorResponse("Invalid id"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      contactDetailSchema.parse(
        await getContactDetail(actor, c.req.valid("param").id),
      ),
    );
  });
}
