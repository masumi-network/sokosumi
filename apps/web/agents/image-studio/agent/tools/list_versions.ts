import { defineTool } from "eve/tools";
import { z } from "zod";

import { listVersions } from "../lib/core";
import { identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "List the image versions in this project, newest first, with each version's review state and which version it was refined from. Use this before refining so you name a real version.",
  inputSchema: z.object({}),
  label: { start: () => "Look at the project's images" },
  async execute(_input, ctx) {
    const identity = identityFrom(ctx);
    const { versions, activeJobs } = await listVersions(identity);
    return {
      versions,
      activeJobs,
      note:
        versions.length === 0
          ? "This project has no images yet."
          : "A version's review state belongs to that version alone.",
    };
  },
});
