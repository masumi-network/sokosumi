import { z } from "zod";

import { AgentJobStatus, OnChainJobStatus } from "@/prisma/generated/client";

export const payloadSchema = z
  .object({
    jobId: z.string().min(1),
    userId: z.string().min(1),
    agentId: z.string().min(1),
    agentJobStatus: z.nativeEnum(AgentJobStatus).nullable(),
    onChainStatus: z.nativeEnum(OnChainJobStatus).nullable(),
  })
  .or(
    z.object({
      now: z.string().datetime(),
    }),
  );

export type PayloadSchemaType = z.infer<typeof payloadSchema>;
