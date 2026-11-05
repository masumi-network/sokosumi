import { createRoute, z } from "@hono/zod-openapi";
import { contactListMembersSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListSchema } from "@/schemas/contact.schema";
import { updateContactListMembers } from "@/services/contact-lists.service";
import { inContactTransaction } from "@/services/contacts.service";
import { contactActor } from "../../contacts/context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("List not found"),
  409: jsonErrorResponse("Name taken, list in use, or a concurrent change"),
  422: jsonErrorResponse("Invalid list"),
};

const idParams = z.object({ id: z.uuid() });

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/members",
    tags: ["Contact lists"],
    description:
      "Add and remove contacts on a manual list in one call. Adding a member twice is a no-op. Smart lists answer 422.",
    request: {
      params: idParams,
      body: {
        content: { "application/json": { schema: contactListMembersSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactListSchema, "List"),
      ...errors,
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
      contactListSchema.parse(
        await inContactTransaction((tx) =>
          updateContactListMembers(tx, actor, id, body),
        ),
      ),
    );
  });
}
