import { defineTool } from "eve/tools";
import { z } from "zod";

import { listImageOptions } from "../lib/core";
import { identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "List every supported image model and placement with verified capabilities, settings, target dimensions, limits, and documentation. Read-only; no generation or charge. Use before choosing non-default models or placement IDs.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    return await listImageOptions(identityFrom(ctx));
  },
});
