import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import {
  isReservedSokoBotSecretName,
  SOKO_BOT_SECRET_NAME_PATTERN,
  SOKO_BOT_SECRET_VALUE_MAX_LENGTH,
  SOKO_BOT_SETUP_COMMAND_LIMIT,
  SOKO_BOT_SETUP_COMMAND_MAX_LENGTH,
} from "@/services/soko-bot-secrets.service";

export const sokoBotSecretNameSchema = z
  .string()
  .regex(
    SOKO_BOT_SECRET_NAME_PATTERN,
    "Use capital letters, digits and underscores, starting with a letter, such as VERCEL_TOKEN",
  )
  .refine((name) => !isReservedSokoBotSecretName(name), {
    message: "This name is reserved for the sandbox itself",
  })
  .openapi({ example: "VERCEL_TOKEN" });

/** A saved key as the owner sees it: never its value. */
export const sokoBotSecretSchema = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ example: "VERCEL_TOKEN" }),
    shellAccess: z.boolean().openapi({
      description: "Whether shell commands get this key as an env variable",
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotSecret");

export const saveSokoBotSecretRequestSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .max(SOKO_BOT_SECRET_VALUE_MAX_LENGTH)
      .optional()
      .openapi({
        description:
          "The key. Required for a new name; leave out to keep the saved value.",
      }),
    shellAccess: z.boolean().optional(),
  })
  .openapi("SaveSokoBotSecretRequest");

export const sokoBotSandboxSetupSchema = z
  .object({
    commands: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(SOKO_BOT_SETUP_COMMAND_MAX_LENGTH)
          .refine((line) => !/[\r\n\0]/.test(line), {
            message: "One command per line",
          }),
      )
      .max(SOKO_BOT_SETUP_COMMAND_LIMIT)
      .openapi({ example: ["npm install -g vercel"] }),
  })
  .openapi("SokoBotSandboxSetup");
