import { defineTool } from "eve/tools";
import { z } from "zod";

import { listImageOptions } from "../lib/core";
import { identityFrom } from "../lib/identity";
import { CURATED_IMAGE_MODEL_IDS } from "../lib/models";

export default defineTool({
  description:
    "List supported Studio models, placements and settings. Read-only; no generation or charge.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const { catalog } = await listImageOptions(identityFrom(ctx));
    const imageIds: readonly string[] = CURATED_IMAGE_MODEL_IDS;
    return {
      catalog: {
        ...catalog,
        defaultModelId: "gemini-pro",
        models: catalog.models.filter(({ id }) => imageIds.includes(id)),
      },
    };
  },
});
