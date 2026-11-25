import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  fundraisingProspectSchema,
  fundraisingProspectUpdateSchema,
} from "@/schemas/fundraising.schema";
import { updateFundraisingProspect } from "@/services/fundraising.service";
import { fundraisingActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/prospects/{contactId}",
    tags: ["Fundraising"],
    description:
      "Changes an investor's stage, owner, cheque, thesis, committed amount, notes or source. Only the fields sent change.",
    request: {
      params: z.object({ contactId: z.uuid() }),
      body: {
        content: {
          "application/json": { schema: fundraisingProspectUpdateSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(fundraisingProspectSchema, "Prospect"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Invalid change"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await fundraisingActor(c);
    const { contactId } = c.req.valid("param");
    return ok(
      c,
      fundraisingProspectSchema.parse(
        await updateFundraisingProspect(actor, contactId, c.req.valid("json")),
      ),
    );
  });
}
