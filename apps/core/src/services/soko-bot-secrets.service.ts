import type { Prisma } from "@sokosumi/database";
import { forbidden, notFound } from "@/helpers/error";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import { organizationRoleInWorkspace } from "@/helpers/soko-bot-management";
import prisma from "@/lib/db/prisma";
import { sealSokoBotSecret } from "@/lib/soko-bot/secret-box";

/** Keys one bot may hold; a handful of command-line tools, not a vault. */
export const SOKO_BOT_SECRET_LIMIT = 20;
export const SOKO_BOT_SECRET_VALUE_MAX_LENGTH = 8_000;
export const SOKO_BOT_SETUP_COMMAND_LIMIT = 10;
export const SOKO_BOT_SETUP_COMMAND_MAX_LENGTH = 500;

/** An environment variable name: `VERCEL_TOKEN`, not `vercel-token`. */
export const SOKO_BOT_SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Names a saved key may not take: they would change how every command in the
 * sandbox runs or finds its certificates, not hand one tool a key.
 */
const RESERVED_SECRET_NAMES =
  /^(PATH|HOME|LANG|TERM|SHELL|USER|PWD|IFS|BASH_ENV|ENV|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_USE_SYSTEM_CA|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE)$|^(LD_|DYLD_|SOKO_)/;

export function isReservedSokoBotSecretName(name: string): boolean {
  return RESERVED_SECRET_NAMES.test(name);
}

export class SokoBotSecretError extends Error {}

type Client = Prisma.TransactionClient | typeof prisma;

const secretSelect = {
  id: true,
  name: true,
  shellAccess: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The personal bot whose keys and setup the caller may change: its owner
 * only. A shared bot is refused, because a key saved on it would be every
 * member's key (ADR 0074).
 */
export async function requireOwnedPersonalSokoBot(
  userId: string,
  sokoBotId: string,
  client: Client = prisma,
): Promise<{ id: string }> {
  const bot = await client.sokoBot.findFirst({
    where: { id: sokoBotId, archivedAt: null, deletedAt: null },
    select: { id: true, userId: true, workspaceId: true },
  });
  if (!bot) throw notFound("Soko Bot not found");
  if (isPersonalSokoBot(bot)) {
    if (bot.userId === userId) return bot;
    throw notFound("Soko Bot not found");
  }
  if (
    (await organizationRoleInWorkspace(userId, bot.workspaceId, client)) ===
    null
  )
    throw notFound("Soko Bot not found");
  throw forbidden(
    "Keys, setup commands and MCP servers are for personal Soko Bots only",
  );
}

export function listSokoBotSecrets(sokoBotId: string, client: Client = prisma) {
  return client.sokoBotSecret.findMany({
    where: { sokoBotId },
    select: secretSelect,
    orderBy: { name: "asc" },
  });
}

/**
 * Saves a key under its name, or changes one that exists. A new key needs a
 * value; an existing one keeps its value when none is given, so switching
 * shell access never asks the owner to paste the key again.
 */
export async function saveSokoBotSecret(input: {
  sokoBotId: string;
  userId: string;
  name: string;
  value?: string;
  shellAccess?: boolean;
}) {
  const sealed =
    input.value === undefined ? null : await sealSokoBotSecret(input.value);
  return prisma.$transaction(async (tx) => {
    const key = { sokoBotId: input.sokoBotId, name: input.name };
    const existing = await tx.sokoBotSecret.findUnique({
      where: { sokoBotId_name: key },
      select: { id: true },
    });
    if (existing) {
      return tx.sokoBotSecret.update({
        where: { id: existing.id },
        data: { ...sealed, shellAccess: input.shellAccess },
        select: secretSelect,
      });
    }
    if (!sealed) throw new SokoBotSecretError("A new key needs a value");
    const count = await tx.sokoBotSecret.count({
      where: { sokoBotId: input.sokoBotId },
    });
    if (count >= SOKO_BOT_SECRET_LIMIT)
      throw new SokoBotSecretError(
        `A Soko Bot holds up to ${SOKO_BOT_SECRET_LIMIT} keys; delete one first`,
      );
    return tx.sokoBotSecret.create({
      data: {
        ...key,
        ...sealed,
        shellAccess: input.shellAccess ?? false,
        createdByUserId: input.userId,
      },
      select: secretSelect,
    });
  });
}

/** Whether a key by that name was there to delete. */
export async function deleteSokoBotSecret(
  sokoBotId: string,
  name: string,
): Promise<boolean> {
  const deleted = await prisma.sokoBotSecret.deleteMany({
    where: { sokoBotId, name },
  });
  return deleted.count > 0;
}
