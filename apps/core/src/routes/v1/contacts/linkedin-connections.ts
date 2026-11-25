import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contactLinkedInImportInputSchema,
  contactLinkedInImportResultSchema,
} from "@/schemas/contact.schema";
import {
  importLinkedInConnections,
  parseLinkedInConnections,
} from "@/services/contact-linkedin-import.service";
import { contactActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/linkedin-connections",
    tags: ["Contacts"],
    description:
      "Imports the caller's LinkedIn connections from a Connections.csv export. Each row becomes or updates a contact by profile URL, joins the \"LinkedIn connections\" list, and records that the caller is connected to them, which the raise's warm paths use.",
    request: {
      body: {
        content: {
          "application/json": { schema: contactLinkedInImportInputSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactLinkedInImportResultSchema, "Imported"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Not a LinkedIn export, or too many rows"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const connections = parseLinkedInConnections(c.req.valid("json").csv);
    return ok(
      c,
      contactLinkedInImportResultSchema.parse(
        await importLinkedInConnections(actor, connections),
      ),
    );
  });
}
