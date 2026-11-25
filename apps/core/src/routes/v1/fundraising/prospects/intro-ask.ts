import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  fundraisingIntroAskInputSchema,
  fundraisingIntroAskResultSchema,
} from "@/schemas/fundraising.schema";
import { draftIntroAsk } from "@/services/fundraising-outreach.service";
import { fundraisingActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/prospects/{contactId}/intro-ask",
    tags: ["Fundraising"],
    description:
      "Asks a connector for a double opt-in introduction to this investor: two drafts land in the caller's own mailbox through their Soko Bot's Gmail, the short ask to the connector and the forwardable note written to the investor. Nothing is sent. The investor's intro is marked as asked, with a nudge date.",
    request: {
      params: z.object({ contactId: z.uuid() }),
      body: {
        content: {
          "application/json": { schema: fundraisingIntroAskInputSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(fundraisingIntroAskResultSchema, "Drafts"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("No mailbox, no connector, or no email address"),
      503: jsonErrorResponse("The model or the mailbox did not answer"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      fundraisingIntroAskResultSchema.parse(
        await draftIntroAsk(
          actor,
          c.req.valid("param").contactId,
          c.req.valid("json"),
        ),
      ),
    );
  });
}
