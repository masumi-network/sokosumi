import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactSchema } from "@/schemas/contact.schema";
import {
  inContactTransaction,
  setReaderImportance,
} from "@/services/contacts.service";
import { contactActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/importance",
    tags: ["Contacts"],
    description:
      "Set how much a contact matters to the caller, 0–100. It is personal: teammates keep their own. Null hands it back to Jev, which judges it from the contact and the caller's interactions.",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              importance: z.int().min(0).max(100).nullable(),
            }),
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactSchema, "Contact"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      422: jsonErrorResponse("Invalid importance"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const { importance } = c.req.valid("json");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) =>
          setReaderImportance(tx, actor, id, importance),
        ),
      ),
    );
  });
}
