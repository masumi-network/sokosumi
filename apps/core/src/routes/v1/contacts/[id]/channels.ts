import { createRoute, z } from "@hono/zod-openapi";
import { contactChannelInputSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactSchema } from "@/schemas/contact.schema";
import {
  addContactChannel,
  inContactTransaction,
  removeContactChannel,
} from "@/services/contacts.service";
import { contactActor } from "../context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not found"),
  409: jsonErrorResponse("Channel taken by another contact, or merged"),
  422: jsonErrorResponse("Invalid channel"),
};

const addRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/channels",
    tags: ["Contacts"],
    description:
      "Add a way to reach a contact. The value is normalized; one that belongs to another contact is a 409 with `kind: contact_channel_taken` and `existingContactId` (merge them instead).",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { "application/json": { schema: contactChannelInputSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactSchema, "Contact"),
      ...errors,
    },
  }),
);

const removeRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/channels/{channelId}",
    tags: ["Contacts"],
    request: { params: z.object({ id: z.uuid(), channelId: z.uuid() }) },
    responses: {
      200: jsonSuccessResponse(contactSchema, "Contact"),
      ...errors,
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(addRoute, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) =>
          addContactChannel(tx, actor, id, body),
        ),
      ),
    );
  });
  app.openapi(removeRoute, async (c) => {
    const actor = await contactActor(c);
    const { id, channelId } = c.req.valid("param");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) =>
          removeContactChannel(tx, actor, id, channelId),
        ),
      ),
    );
  });
}
