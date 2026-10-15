import { z } from "@hono/zod-openapi";

import { coworkerSummarySchema } from "@/schemas/coworker.schema";
import { sokoBotSummarySchema } from "@/schemas/soko-bot.schema";
import { userSummarySchema } from "@/schemas/user.schema";

const workCreatorUserSchema = z
  .object({
    type: z.literal("user"),
    id: z.string().openapi({ example: "user_123" }),
    user: userSummarySchema,
  })
  .openapi("WorkCreatorUser");

const workCreatorCoworkerSchema = z
  .object({
    type: z.literal("coworker"),
    id: z.string().openapi({ example: "cow_123" }),
    coworker: coworkerSummarySchema,
  })
  .openapi("WorkCreatorCoworker");

const workCreatorSokoBotSchema = z
  .object({
    type: z.literal("sokoBot"),
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    sokoBot: sokoBotSummarySchema,
  })
  .openapi("WorkCreatorSokoBot");

const workCreatorSchema = z
  .discriminatedUnion("type", [
    workCreatorUserSchema,
    workCreatorCoworkerSchema,
    workCreatorSokoBotSchema,
  ])
  .openapi("WorkCreator");

/** `responsibleUserId` of a Task, Task Schedule or Job (ADR 0056). */
export const responsibleUserIdField = {
  responsibleUserId: z.union([z.string(), z.null()]).openapi({
    example: "user_123",
    description:
      "The person responsible for it: its Owner, else the person who made it, else the person it was made for. Null when nobody is: a Soko Bot started it on its own, or the person who made it deleted their account.",
  }),
};

const responsibleUserWithEmailBaseSchema = z.union([
  z.object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
  }),
  z.null(),
]);

/** `responsibleUser` of an admin or developer Task view (ADR 0056). */
export const responsibleUserWithEmailSchema =
  responsibleUserWithEmailBaseSchema.openapi({
    description:
      "The person responsible for the task, with their email address; null only when nobody is responsible for the work.",
  });

/** Deprecated `owner` of an admin or developer Task view, the same value. */
export const deprecatedResponsibleUserWithEmailSchema =
  responsibleUserWithEmailBaseSchema.openapi({
    deprecated: true,
    description: "Deprecated. Use responsibleUser.",
  });

/** Said of every deprecated Owner field, which carries the responsible person. */
export const WORK_OWNER_DESCRIPTION =
  "Deprecated. Use responsibleUserId instead. The person responsible for the work; null only when nobody is responsible for the work.";

/**
 * Deprecated `ownerId`/`owner` of a Task, Task Schedule or Job, and their
 * older `userId`/`user` aliases: all carry the responsible person (ADR 0056).
 */
export const deprecatedWorkOwnerIdSchema = z
  .union([z.string(), z.null()])
  .openapi({
    example: "user_123",
    deprecated: true,
    description: WORK_OWNER_DESCRIPTION,
  });

export const deprecatedWorkOwnerSchema = z
  .union([userSummarySchema, z.null()])
  .openapi({ deprecated: true, description: WORK_OWNER_DESCRIPTION });

/** `creator` and `requester` of a Task, Task Schedule or Job (ADR 0056). */
export const workCreatorRequesterFields = {
  creator: z.union([workCreatorSchema, z.null()]).openapi({
    description:
      "Who made it: a person, a Coworker or a Soko Bot. Null when the person who made it deleted their account.",
  }),
  requester: z.union([userSummarySchema, z.null()]).openapi({
    description:
      "The person a Coworker or Soko Bot made it for. Null when a person made it themselves, when nobody asked, or when that person deleted their account. A record only; it grants no access.",
  }),
};
