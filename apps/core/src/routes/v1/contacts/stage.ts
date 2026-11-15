import { createRoute, z } from "@hono/zod-openapi";
import { setContactsStageSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  inContactTransaction,
  setContactsStage,
} from "@/services/contacts.service";
import { contactActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/stage",
    tags: ["Contacts"],
    description:
      "Set one stage on up to 500 contacts. Every id must be a live contact of this workspace, or nothing changes (404). `updated` counts the contacts whose stage changed.",
    request: {
      body: {
        content: { "application/json": { schema: setContactsStageSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({ updated: z.int().nonnegative() }),
        "Stage set",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      409: jsonErrorResponse("A concurrent change"),
      422: jsonErrorResponse("Invalid stage or contacts"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { contactIds, stage } = c.req.valid("json");
    return ok(
      c,
      await inContactTransaction((tx) =>
        setContactsStage(tx, actor, contactIds, stage),
      ),
    );
  });
}
