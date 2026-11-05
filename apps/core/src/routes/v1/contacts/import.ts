import { createRoute } from "@hono/zod-openapi";
import { contactImportSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactImportResultSchema } from "@/schemas/contact.schema";
import { importContactsFromTable } from "@/services/contacts-import.service";
import { contactActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/import",
    tags: ["Contacts"],
    description:
      "Import the rows of a Files table in this workspace as contacts, mapping contact fields to columns (by id or name). Rows match existing contacts by channel, then by name; only empty fields are filled, so running it again changes nothing. A list column puts each contact on the lists it names; a first-contact column becomes the first interaction.",
    request: {
      body: {
        content: { "application/json": { schema: contactImportSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactImportResultSchema, "Import summary"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Table not found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Invalid mapping"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      contactImportResultSchema.parse(
        await importContactsFromTable(actor, c.req.valid("json")),
      ),
    );
  });
}
