import { defineTool } from "eve/tools";
import { z } from "zod";

import { readBrandContext } from "../lib/core";
import { identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "Read compact brand and marketing strategy reference copy for a new brief in this project.",
  inputSchema: z.object({}),
  label: { start: () => "Read the project's brand and strategy" },
  async execute(_input, ctx) {
    return await readBrandContext(identityFrom(ctx));
  },
});
