import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";

/** Safe on a room-wide wire: resource references and snapshots stay in Core. */
export const chatResultDescriptorSchema = z
  .object({
    id: z.string().uuid(),
    capturedAt: dateTimeSchema,
  })
  .openapi("ChatResultDescriptor");
