import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListSchema } from "@/schemas/contact.schema";
import { importContactListText } from "@/services/contact-list-text-import.service";
import { contactActor } from "../../contacts/context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/import",
    tags: ["Contact lists"],
    description:
      "Add the people in a pasted list (a CSV export, or one address a line) to a manual list. Each address becomes a contact, or matches the one it already belongs to.",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ text: z.string().min(1).max(2_000_000) }),
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactListSchema, "List"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("List not found"),
      409: jsonErrorResponse("A concurrent change"),
      422: jsonErrorResponse("No addresses, too many, or a smart list"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const { text } = c.req.valid("json");
    return ok(
      c,
      contactListSchema.parse(await importContactListText(actor, id, text)),
    );
  });
}
