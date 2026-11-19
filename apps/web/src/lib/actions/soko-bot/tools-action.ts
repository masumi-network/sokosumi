"use server";

import type { SokoBotMcpServer, SokoBotSecret } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

/**
 * A personal bot's MCP servers, saved keys and setup commands (ADR 0074).
 * Core checks the owner and the values; these only shape the request.
 */

interface ToolsParams extends AuthenticatedRequest {
  input: unknown;
}

const invalidInput = (): ActionError => ({
  code: CommonErrorCode.BAD_INPUT,
  message: "Invalid input",
});

const botId = z.uuid();
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);

async function run<T>(work: () => Promise<T>) {
  try {
    return toActionResult(ok(await work()));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
}

const saveSecretSchema = z.object({
  botId,
  name: secretName,
  value: z.string().min(1).max(8_000).optional(),
  shellAccess: z.boolean().optional(),
});

export const saveSokoBotSecretAction = withSession<
  ToolsParams,
  ActionResultDto<SokoBotSecret, ActionError>
>(async ({ input }) => {
  const parsed = saveSecretSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  const { botId: id, name, ...change } = parsed.data;
  return run(() => sokoBotService.saveSecret(id, name, change));
});

const deleteSecretSchema = z.object({ botId, name: secretName });

export const deleteSokoBotSecretAction = withSession<
  ToolsParams,
  ActionResultDto<null, ActionError>
>(async ({ input }) => {
  const parsed = deleteSecretSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  return run(async () => {
    await sokoBotService.deleteSecret(parsed.data.botId, parsed.data.name);
    return null;
  });
});

const setupSchema = z.object({
  botId,
  commands: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const setSokoBotSandboxSetupAction = withSession<
  ToolsParams,
  ActionResultDto<string[], ActionError>
>(async ({ input }) => {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  return run(() =>
    sokoBotService.setSandboxSetup(parsed.data.botId, parsed.data.commands),
  );
});

const addServerSchema = z.object({
  botId,
  name: z.string().trim().min(1).max(40),
  url: z.string().trim().min(1).max(2_000),
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), token: z.string().trim().min(1) }),
    z.object({
      type: z.literal("header"),
      name: z.string().trim().min(1).max(64),
      value: z.string().min(1),
    }),
  ]),
});

export const addSokoBotMcpServerAction = withSession<
  ToolsParams,
  ActionResultDto<SokoBotMcpServer, ActionError>
>(async ({ input }) => {
  const parsed = addServerSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  const { botId: id, ...server } = parsed.data;
  return run(() => sokoBotService.addMcpServer(id, server));
});

const serverSchema = z.object({ botId, serverId: z.uuid() });

export const refreshSokoBotMcpServerAction = withSession<
  ToolsParams,
  ActionResultDto<SokoBotMcpServer, ActionError>
>(async ({ input }) => {
  const parsed = serverSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  return run(() =>
    sokoBotService.refreshMcpServer(parsed.data.botId, parsed.data.serverId),
  );
});

export const removeSokoBotMcpServerAction = withSession<
  ToolsParams,
  ActionResultDto<null, ActionError>
>(async ({ input }) => {
  const parsed = serverSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  return run(async () => {
    await sokoBotService.removeMcpServer(
      parsed.data.botId,
      parsed.data.serverId,
    );
    return null;
  });
});

const toolSchema = serverSchema.extend({
  name: z.string().min(1).max(128),
  enabled: z.boolean().optional(),
  readOnly: z.boolean().optional(),
});

export const updateSokoBotMcpToolAction = withSession<
  ToolsParams,
  ActionResultDto<SokoBotMcpServer, ActionError>
>(async ({ input }) => {
  const parsed = toolSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  const { botId: id, serverId, ...change } = parsed.data;
  return run(() => sokoBotService.updateMcpTool(id, serverId, change));
});
