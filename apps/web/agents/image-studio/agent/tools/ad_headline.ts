import { MAX_STUDIO_HEADLINE_LENGTH } from "@sokosumi/utils";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { readAdHeadline, saveAdHeadline } from "../lib/core";
import { identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "Read or change a ready ad's export headline without generating an image. Read before saving to get its current revision and the exact approved lines.",
  inputSchema: z.object({
    action: z.enum(["read", "save"]),
    assetId: z
      .uuid()
      .describe("The selected or explicitly identified image version."),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Required to save. Use the revision from the read action."),
    text: z
      .string()
      .min(1)
      .max(MAX_STUDIO_HEADLINE_LENGTH)
      .nullable()
      .optional()
      .describe(
        "Required to save. Exact wording from approvedLines, or null when asked to clear it.",
      ),
  }),
  label: {
    start: ({ action }) =>
      action === "read" ? "Check approved headlines" : "Update ad headline",
  },
  async execute(input, ctx) {
    const identity = identityFrom(ctx);
    if (input.action === "read")
      return await readAdHeadline(identity, input.assetId);
    const { assetId, text, expectedRevision } = input;
    if (text === undefined || expectedRevision === undefined) {
      throw new Error(
        "Read the ad first, then provide its revision and the exact headline or null.",
      );
    }
    const headline = await saveAdHeadline(identity, assetId, {
      text,
      expectedRevision,
    });
    return { assetId, headline };
  },
});
