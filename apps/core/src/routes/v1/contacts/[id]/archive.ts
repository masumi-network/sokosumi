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
  setContactArchived,
} from "@/services/contacts.service";
import { contactActor } from "../context";

function archiveRoute(path: "archive" | "unarchive") {
  return withCoworkerContextHeaderParameters(
    createRoute({
      method: "post",
      path: `/{id}/${path}`,
      tags: ["Contacts"],
      description:
        path === "archive"
          ? "Hide a contact from lists and searches; it keeps its channels."
          : "Bring an archived contact back.",
      request: { params: z.object({ id: z.uuid() }) },
      responses: {
        200: jsonSuccessResponse(contactSchema, "Contact"),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
        404: jsonErrorResponse("Contact not found"),
        409: jsonErrorResponse("Merged contact or a concurrent change"),
        422: jsonErrorResponse("Invalid id"),
      },
    }),
  );
}

export default function mount(app: OpenAPIHonoWithAuth) {
  for (const path of ["archive", "unarchive"] as const)
    app.openapi(archiveRoute(path), async (c) => {
      const actor = await contactActor(c);
      const { id } = c.req.valid("param");
      return ok(
        c,
        contactSchema.parse(
          await inContactTransaction((tx) =>
            setContactArchived(tx, actor, id, path === "archive"),
          ),
        ),
      );
    });
}
