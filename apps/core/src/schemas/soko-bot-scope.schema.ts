import { z } from "@hono/zod-openapi";
import { isValidTimezone } from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import { sokoBotSchema, sokoBotStatusSchema } from "./soko-bot.schema";

/** Personal (one owner), project or workspace (shared by the organization). */
export const sokoBotScopeSchema = z
  .enum(["personal", "project", "workspace"])
  .openapi("SokoBotScope");

export type SokoBotScope = z.infer<typeof sokoBotScopeSchema>;

export const createSokoBotRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    avatarSeed: z.string().max(200).nullable().optional(),
    /** Soko Bot avatar from the pool to claim for this bot. */
    avatarId: z.string().uuid().nullable().optional(),
    personalityTone: z.number().int().min(0).max(100).nullable().optional(),
    personalityDetail: z.number().int().min(0).max(100).nullable().optional(),
    personalityStyle: z.number().int().min(0).max(100).nullable().optional(),
    /**
     * IANA timezone for the bot's day, usually the creator's browser
     * timezone. Set on a new bot only; reactivation keeps the bot's own.
     */
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimezone, "Unknown timezone")
      .optional(),
  })
  .strict()
  .openapi("CreateSokoBotRequest");

/** A new name, held to the same rule as the name a bot is created with. */
export const renameSokoBotRequestSchema = createSokoBotRequestSchema
  .pick({ name: true })
  .strict()
  .openapi("RenameSokoBotRequest");

export const createScopedSokoBotRequestSchema = createSokoBotRequestSchema
  .extend({
    scope: sokoBotScopeSchema,
    /** Required for `project`, refused otherwise. */
    projectId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((body) => (body.scope === "project") === Boolean(body.projectId), {
    message: "projectId is required for a project bot and only for one",
    path: ["projectId"],
  })
  .openapi("CreateScopedSokoBotRequest");

export type CreateScopedSokoBotRequest = z.infer<
  typeof createScopedSokoBotRequestSchema
>;

/** One project or workspace bot in the roster. */
export const sharedSokoBotSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    scope: z.enum(["project", "workspace"]),
    projectId: z.string().uuid().nullable(),
    avatarSeed: z.string().nullable(),
    avatarImageUrl: z.string().nullable(),
    status: sokoBotStatusSchema,
    archivedAt: dateTimeSchema.nullable(),
    /** The room every member shares with this bot. */
    sharedRoomId: z.string().uuid().nullable(),
    viewerCanManage: z.boolean(),
    /** Cuso, archived or not: CMO alone changes him (ADR 0066). */
    cuso: z.boolean(),
  })
  .openapi("SharedSokoBotSummary");

export const sokoBotStateSchema = z
  .object({
    // hey-api supports a named-schema union with null, but Swift codegen drops it.
    // Inline the nullable object to keep the named SokoBot schema non-nullable.
    sokoBot: z.object(sokoBotSchema.shape).nullable(),
    /** Project and workspace bots the viewer can reach. Absent for a Soko Bot's own key. */
    sharedBots: z.array(sharedSokoBotSummarySchema).optional(),
    /**
     * While your bot is in error: the failed reply of its last failed turn and
     * its room, when that turn answered a chat you can still open. Both null
     * for other work (a schedule, an event) or a room you cannot open.
     */
    lastFailure: z
      .object({
        roomId: z.string().uuid().nullable(),
        messageId: z.string().uuid().nullable(),
      })
      .nullable()
      .optional(),
  })
  .openapi("SokoBotState");
