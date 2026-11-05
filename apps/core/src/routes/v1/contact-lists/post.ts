import { createRoute } from "@hono/zod-openapi";
import { contactListInputSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListSchema } from "@/schemas/contact.schema";
import { createContactList } from "@/services/contact-lists.service";
import { inContactTransaction } from "@/services/contacts.service";
import { contactActor } from "../contacts/context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("List not found"),
  409: jsonErrorResponse("Name taken, list in use, or a concurrent change"),
  422: jsonErrorResponse("Invalid list"),
};

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Contact lists"],
    description:
      "Create a manual list, or a smart list by giving `smartFilter`. Names are unique per workspace, ignoring case.",
    request: {
      body: {
        content: { "application/json": { schema: contactListInputSchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(contactListSchema, "List created"),
      ...errors,
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const body = c.req.valid("json");
    return created(
      c,
      contactListSchema.parse(
        await inContactTransaction((tx) => createContactList(tx, actor, body)),
      ),
    );
  });
}
