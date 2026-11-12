import { defineTool } from "eve/tools";
import { z } from "zod";

import { listStudioProducts } from "../lib/core";
import { identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "List saved product names and ids for this project. Look up the product before featuring it or swapping it into an existing ad.",
  inputSchema: z.object({}),
  label: { start: () => "Look up the project's products" },
  async execute(_input, ctx) {
    return await listStudioProducts(identityFrom(ctx));
  },
});
