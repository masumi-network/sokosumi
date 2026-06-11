import * as z from "zod";

export const designMdOwnerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
  }),
  z.object({
    organizationId: z.string().min(1),
    type: z.literal("organization"),
  }),
]);

export const startDesignMdGenerationSchema = z.object({
  force: z.boolean().optional(),
  owner: designMdOwnerSchema,
  url: z.httpUrl(),
});

export const pollDesignMdGenerationSchema = z.object({
  jobId: z.string().min(1),
  jobToken: z.string().min(1),
  owner: designMdOwnerSchema,
});

export const finalizeDesignMdGenerationSchema = z.object({
  jobId: z.string().min(1),
  jobToken: z.string().min(1),
  owner: designMdOwnerSchema,
});

export const saveDesignMdUploadSchema = z.object({
  owner: designMdOwnerSchema,
  content: z.string().min(1),
});

export const removeDesignMdSchema = z.object({
  owner: designMdOwnerSchema,
});

export type DesignMdOwnerSchemaType = z.infer<typeof designMdOwnerSchema>;
export type FinalizeDesignMdGenerationSchemaType = z.infer<
  typeof finalizeDesignMdGenerationSchema
>;
export type PollDesignMdGenerationSchemaType = z.infer<
  typeof pollDesignMdGenerationSchema
>;
export type RemoveDesignMdSchemaType = z.infer<typeof removeDesignMdSchema>;
export type SaveDesignMdUploadSchemaType = z.infer<
  typeof saveDesignMdUploadSchema
>;
export type StartDesignMdGenerationSchemaType = z.infer<
  typeof startDesignMdGenerationSchema
>;
