import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  fundraisingDraftInputSchema,
  fundraisingDraftResultSchema,
} from "@/schemas/fundraising.schema";
import { draftOutreach } from "@/services/fundraising-outreach.service";
import { fundraisingActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/prospects/{contactId}/draft",
    tags: ["Fundraising"],
    description:
      "Writes a short outreach mail for this investor (a first mail, an intro request to a mutual contact, or a follow-up) and puts it in the caller's own mailbox as a draft through their Soko Bot's Gmail. Nothing is sent. Optionally lets the investor into a data room and links it.",
    request: {
      params: z.object({ contactId: z.uuid() }),
      body: {
        content: {
          "application/json": { schema: fundraisingDraftInputSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(fundraisingDraftResultSchema, "Draft"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("No mailbox, or no email address"),
      503: jsonErrorResponse("The model or the mailbox did not answer"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      fundraisingDraftResultSchema.parse(
        await draftOutreach(
          actor,
          c.req.valid("param").contactId,
          c.req.valid("json"),
        ),
      ),
    );
  });
}
