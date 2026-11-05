import { createRoute, z } from "@hono/zod-openapi";
import { updateContactSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactSchema } from "@/schemas/contact.schema";
import {
  inContactTransaction,
  updateContact,
} from "@/services/contacts.service";
import { contactActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["Contacts"],
    description:
      "Change contact fields. `version` must be the one last read; otherwise 409 with `kind: contact_version_conflict`. Omitted fields stay; null clears.",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { "application/json": { schema: updateContactSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactSchema, "Contact updated"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      409: jsonErrorResponse("Version conflict or merged contact"),
      422: jsonErrorResponse("Invalid contact"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) => updateContact(tx, actor, id, body)),
      ),
    );
  });
}
