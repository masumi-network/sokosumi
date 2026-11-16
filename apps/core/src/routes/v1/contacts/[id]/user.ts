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
  setContactUser,
} from "@/services/contacts.service";
import { contactActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/user",
    tags: ["Contacts"],
    description:
      "Say which workspace member this contact is, e.g. the caller themselves; null says it is no member. A member is one contact at most: another contact linked to them lets go.",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ userId: z.string().min(1).max(200).nullable() }),
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactSchema, "Contact"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      409: jsonErrorResponse("Contact was merged"),
      422: jsonErrorResponse("Not a member of this workspace"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) =>
          setContactUser(tx, actor, id, userId),
        ),
      ),
    );
  });
}
