import { defineTool } from "eve/tools";
import { z } from "zod";

import { readGeneration } from "../lib/core";
import { identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "Look up a generation you started. Reports whether it is still queued or running, whether it produced a version, or why it failed.",
  inputSchema: z.object({
    jobId: z.string().uuid(),
  }),
  label: { start: () => "Check the generation" },
  async execute(input, ctx) {
    const identity = identityFrom(ctx);
    const { job, version } = await readGeneration(identity, input.jobId);
    return {
      status: job.status,
      error: job.error,
      version,
      guidance: job.retryMayDuplicateCharge
        ? "This submission was never confirmed by the provider. Do not start another generation to compensate. Tell the person it may already have been charged and let them decide."
        : job.status === "QUEUED" || job.status === "RUNNING"
          ? "Still working. Generation takes time; do not promise when it will finish."
          : null,
    };
  },
});
