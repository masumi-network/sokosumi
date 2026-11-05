import { createRoute } from "@hono/zod-openapi";
import { createContactSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactUpsertResultSchema } from "@/schemas/contact.schema";
import {
  inContactTransaction,
  upsertContact,
} from "@/services/contacts.service";
import { contactActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Contacts"],
    description:
      "Create a contact from a name and/or channels. A channel that already belongs to a contact is a 409 with `kind: contact_channel_taken` and `existingContactId`, unless `upsert` is true: then the missing channels are attached to that contact and its empty fields filled. Channels that belong to two different contacts come back as a merge suggestion.",
    request: {
      body: {
        content: { "application/json": { schema: createContactSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        contactUpsertResultSchema,
        "Existing contact updated (upsert)",
      ),
      201: jsonSuccessResponse(contactUpsertResultSchema, "Contact created"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Channel already taken, or a concurrent change"),
      422: jsonErrorResponse("Invalid contact"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const body = c.req.valid("json");
    const result = contactUpsertResultSchema.parse(
      await inContactTransaction((tx) => upsertContact(tx, actor, body)),
    );
    return result.created ? created(c, result) : ok(c, result);
  });
}
