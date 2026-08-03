import * as z from "zod";

/** A DESIGN.md a caller may persist to — their own profile, or (with
 * organization owner/admin authority) an organization's. */
export const manageableDesignMdOwnerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
  }),
  z.object({
    organizationId: z.string().min(1),
    type: z.literal("organization"),
  }),
]);

/**
 * A manageable owner, or ad hoc: task-scoped generation never attached to any
 * user's or organization's profile (see `designMdService`'s ad hoc branches).
 * Only generation accepts this wider union — persisting an upload or removing
 * a DESIGN.md always targets a real, manageable owner.
 */
export const designMdOwnerSchema = z.discriminatedUnion("type", [
  ...manageableDesignMdOwnerSchema.options,
  z.object({
    type: z.literal("adhoc"),
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
  owner: manageableDesignMdOwnerSchema,
  content: z.string().min(1),
});

export const removeDesignMdSchema = z.object({
  owner: manageableDesignMdOwnerSchema,
});

export type DesignMdOwnerSchemaType = z.infer<typeof designMdOwnerSchema>;
export type ManageableDesignMdOwnerSchemaType = z.infer<
  typeof manageableDesignMdOwnerSchema
>;
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
