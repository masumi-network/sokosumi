import { SocialStatisticsResearchErrorSchema } from "@sokosumi/core-client/schemas";
import { z } from "zod";

const code = z.enum(SocialStatisticsResearchErrorSchema.properties.code.enum);

// Pick only public fields; Core flattens its HTTPException extensions into the body.
export const socialStatisticsResearchErrorSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    code: code.optional().catch(undefined),
    retryAfterSeconds: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .catch(undefined),
    extensions: z.object({ code: code.optional() }).optional(),
  })
  .transform(({ extensions, ...error }) => ({
    ...error,
    code: error.code ?? extensions?.code,
  }));
