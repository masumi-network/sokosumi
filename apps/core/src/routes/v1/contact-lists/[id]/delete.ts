import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { deleteContactList } from "@/services/contact-lists.service";
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
    method: "delete",
    path: "/{id}",
    tags: ["Contact lists"],
    description:
      "Delete a list; its contacts stay. A list a smart list refers to is a 409.",
    request: { params: idParams },
    responses: {
      204: { description: "List deleted" },
      ...errors,
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    await inContactTransaction((tx) => deleteContactList(tx, actor, id));
    return empty(c);
  });
}
