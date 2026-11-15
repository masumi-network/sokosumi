import { createRoute, z } from "@hono/zod-openapi";
import {
  setContactsStageSchema,
  undoContactsStageSchema,
} from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  inContactTransaction,
  setContactsStage,
  undoContactsStage,
} from "@/services/contacts.service";
import { contactActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/stage",
    tags: ["Contacts"],
    description:
      "Set one stage on up to 500 contacts. Every id must be a live contact of this workspace, or nothing changes (404). `updated` counts the contacts whose stage changed; `undo` is the body for `POST /contacts/stage/undo`.",
    request: {
      body: {
        content: { "application/json": { schema: setContactsStageSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({
          updated: z.int().nonnegative(),
          undo: z.array(undoContactsStageSchema.shape.contacts.element),
        }),
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

const undoRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/stage/undo",
    tags: ["Contacts"],
    description:
      "Put each contact back on its own earlier stage, all in one transaction. A contact whose version moved on, that was merged, or that is not in this workspace is skipped and counted in `skipped`, so an undo never overwrites a later edit.",
    request: {
      body: {
        content: { "application/json": { schema: undoContactsStageSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({
          restored: z.int().nonnegative(),
          skipped: z.int().nonnegative(),
        }),
        "Stages restored",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("A concurrent change"),
      422: jsonErrorResponse("Invalid contacts"),
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
  app.openapi(undoRoute, async (c) => {
    const actor = await contactActor(c);
    const { contacts } = c.req.valid("json");
    return ok(
      c,
      await inContactTransaction((tx) =>
        undoContactsStage(tx, actor, contacts),
      ),
    );
  });
}
