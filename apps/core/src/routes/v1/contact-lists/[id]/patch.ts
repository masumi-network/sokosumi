import { createRoute, z } from "@hono/zod-openapi";
import { contactListUpdateSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListSchema } from "@/schemas/contact.schema";
import { updateContactList } from "@/services/contact-lists.service";
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
    method: "patch",
    path: "/{id}",
    tags: ["Contact lists"],
    description:
      "Rename, recolor or describe a list, or change a smart list's filter. Giving a manual list a filter turns it into a smart list and drops its members.",
    request: {
      params: idParams,
      body: {
        content: { "application/json": { schema: contactListUpdateSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactListSchema, "List updated"),
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
          updateContactList(tx, actor, id, body),
        ),
      ),
    );
  });
}
