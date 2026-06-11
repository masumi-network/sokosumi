import { z } from "zod";

export const designMdSubmitInputSchema = z.object({
  url: z.url(),
  force: z.boolean().optional(),
});

export const designMdDonePayloadSchema = z.object({
  status: z.literal("done"),
  extractionId: z.union([z.string(), z.number()]),
  designMd: z.string().min(1),
  cached: z.boolean().optional(),
  source: z.string().optional(),
});

export const designMdQueuedPayloadSchema = z.object({
  status: z.literal("queued"),
  jobId: z.string().min(1),
});

export const designMdRunningPayloadSchema = z.object({
  status: z.literal("running"),
  jobId: z.string().min(1),
});

export const designMdFailedPayloadSchema = z.object({
  status: z.literal("failed"),
  error: z.string().optional(),
  message: z.string().optional(),
});

const designMdPayloadSchema = z.discriminatedUnion("status", [
  designMdDonePayloadSchema,
  designMdQueuedPayloadSchema,
  designMdRunningPayloadSchema,
  designMdFailedPayloadSchema,
]);

export const designMdApiResponseSchema = z
  .union([
    designMdPayloadSchema,
    z.object({
      data: designMdPayloadSchema,
    }),
  ])
  .transform((payload) => ("data" in payload ? payload.data : payload));

export type DesignMdSubmitInput = z.infer<typeof designMdSubmitInputSchema>;
export type DesignMdDonePayload = z.infer<typeof designMdDonePayloadSchema>;
export type DesignMdQueuedPayload = z.infer<typeof designMdQueuedPayloadSchema>;
export type DesignMdRunningPayload = z.infer<
  typeof designMdRunningPayloadSchema
>;
export type DesignMdFailedPayload = z.infer<typeof designMdFailedPayloadSchema>;
export type DesignMdJobPayload = z.infer<typeof designMdPayloadSchema>;

export function isDesignMdJobInProgress(
  payload: DesignMdJobPayload,
): payload is DesignMdQueuedPayload | DesignMdRunningPayload {
  return payload.status === "queued" || payload.status === "running";
}
