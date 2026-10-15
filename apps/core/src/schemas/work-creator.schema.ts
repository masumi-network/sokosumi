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

const OWNER_DESCRIPTION =
  "The Owner: the person who answers for the work, and the only reader of private work. Null when it has none: a Soko Bot started it on its own, or its Owner deleted their account.";

/** `ownerId` and `owner` of a Task, Task Schedule or Job (ADR 0057). */
export const workOwnerIdSchema = z
  .union([z.string(), z.null()])
  .openapi({ example: "user_123", description: OWNER_DESCRIPTION });

export const workOwnerSchema = z
  .union([userSummarySchema, z.null()])
  .openapi({ description: OWNER_DESCRIPTION });

/** The older `userId`/`user` aliases of `ownerId`/`owner`. */
export const deprecatedWorkUserIdSchema = z
  .union([z.string(), z.null()])
  .openapi({
    example: "user_123",
    deprecated: true,
    description: "Deprecated. Use ownerId instead.",
  });

export const deprecatedWorkUserSchema = z
  .union([userSummarySchema, z.null()])
  .openapi({ deprecated: true, description: "Deprecated. Use owner instead." });

/** `owner` of an admin or developer Task view, with an email address. */
export const workOwnerWithEmailSchema = z
  .union([
    z.object({
      id: z.string().openapi({ example: "user_123" }),
      name: z.string().openapi({ example: "Ada Lovelace" }),
      email: z.string().openapi({ example: "ada@example.com" }),
    }),
    z.null(),
  ])
  .openapi({ description: OWNER_DESCRIPTION });

/** `creator` of a Task, Task Schedule or Job. */
export const workCreatorField = {
  creator: z.union([workCreatorSchema, z.null()]).openapi({
    description:
      "Who made it: a person, a Coworker or a Soko Bot. Null when the person who made it deleted their account.",
  }),
};
