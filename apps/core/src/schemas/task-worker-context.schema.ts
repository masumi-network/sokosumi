import { z } from "@hono/zod-openapi";

export const TASK_WORKER_CONTEXT_VERSION = 1;

/** Assertions about an already-authorized Task, never caller-selected authority. */
export const taskWorkerContextSchema = z
  .strictObject({
    ownerId: z.string().min(1).max(128),
    organizationId: z.string().min(1).max(128).nullable(),
    workspaceId: z.uuid(),
  })
  .openapi("TaskWorkerContext");

/** Blob signs the original actor and Task context at upload authorization. */
export const taskFileWorkerBindingSchema = z.strictObject({
  contextVersion: z.literal(TASK_WORKER_CONTEXT_VERSION),
  expectedContext: taskWorkerContextSchema,
  coworkerId: z.string().min(1),
  vendorId: z.string().min(1),
});

export type TaskWorkerContext = z.infer<typeof taskWorkerContextSchema>;
export type TaskFileWorkerBinding = z.infer<typeof taskFileWorkerBindingSchema>;
