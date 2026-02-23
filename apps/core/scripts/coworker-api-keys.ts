import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import { createPrismaClient } from "@sokosumi/database/client";

const COWORKER_API_KEY_PREFIX = "soko_coworker_";
const COWORKER_API_KEY_RANDOM_BYTES = 32;
const COWORKER_API_KEY_START_LENGTH = 16;

function printUsage() {
  console.error(
    [
      "Usage:",
      "  pnpm --filter core coworker-keys:create -- --coworker <id-or-slug> [--name <label>] [--expires-at <ISO>]",
      "  pnpm --filter core coworker-keys:revoke -- --key-id <id>",
    ].join("\n"),
  );
}

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for option ${arg}`);
    }

    options[arg.slice(2)] = value;
    index += 1;
  }

  return options;
}

function hashCoworkerApiKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function generateCoworkerApiKeyToken(): string {
  return `${COWORKER_API_KEY_PREFIX}${randomBytes(
    COWORKER_API_KEY_RANDOM_BYTES,
  ).toString("base64url")}`;
}

function parseExpiresAt(rawExpiresAt: string | undefined): Date | null {
  if (!rawExpiresAt) {
    return null;
  }

  const expiresAt = new Date(rawExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error(`Invalid --expires-at value: ${rawExpiresAt}`);
  }

  return expiresAt;
}

async function resolveCoworker(
  prisma: ReturnType<typeof createPrismaClient>,
  identifier: string,
) {
  const coworkerById = await prisma.coworker.findUnique({
    where: {
      id: identifier,
    },
    select: {
      id: true,
      slug: true,
      name: true,
    },
  });

  if (coworkerById) {
    return coworkerById;
  }

  const coworkerBySlug = await prisma.coworker.findUnique({
    where: {
      slug: identifier,
    },
    select: {
      id: true,
      slug: true,
      name: true,
    },
  });

  if (coworkerBySlug) {
    return coworkerBySlug;
  }

  throw new Error(`Coworker not found: ${identifier}`);
}

async function createCoworkerApiKey(
  prisma: ReturnType<typeof createPrismaClient>,
  options: Record<string, string>,
) {
  const coworkerIdentifier = options.coworker;
  if (!coworkerIdentifier) {
    throw new Error("Missing required option --coworker");
  }

  const coworker = await resolveCoworker(prisma, coworkerIdentifier);
  const expiresAt = parseExpiresAt(options["expires-at"]);
  const token = generateCoworkerApiKeyToken();
  const keyHash = hashCoworkerApiKey(token);
  const keyStart = token.slice(0, COWORKER_API_KEY_START_LENGTH);

  const key = await prisma.coworkerApiKey.create({
    data: {
      coworkerId: coworker.id,
      name: options.name ?? null,
      keyHash,
      keyStart,
      expiresAt,
      revokedAt: null,
    },
    select: {
      id: true,
      coworkerId: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  console.log(
    `Created coworker API key ${key.id} for coworker ${coworker.name} (${coworker.slug}).`,
  );
  console.log(`Coworker ID: ${key.coworkerId}`);
  console.log(`Created At: ${key.createdAt.toISOString()}`);
  if (key.expiresAt) {
    console.log(`Expires At: ${key.expiresAt.toISOString()}`);
  }
  console.log(`Token: ${token}`);
  console.log("Store this token securely now. It will not be shown again.");
}

async function revokeCoworkerApiKey(
  prisma: ReturnType<typeof createPrismaClient>,
  options: Record<string, string>,
) {
  const keyId = options["key-id"];
  if (!keyId) {
    throw new Error("Missing required option --key-id");
  }

  const key = await prisma.coworkerApiKey.findUnique({
    where: {
      id: keyId,
    },
    select: {
      id: true,
      revokedAt: true,
    },
  });

  if (!key) {
    throw new Error(`Coworker API key not found: ${keyId}`);
  }

  if (key.revokedAt) {
    console.log(`Coworker API key ${keyId} is already revoked.`);
    return;
  }

  await prisma.coworkerApiKey.update({
    where: {
      id: keyId,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  console.log(`Revoked coworker API key ${keyId}.`);
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (command !== "create" && command !== "revoke") {
    printUsage();
    throw new Error(`Unsupported command: ${command ?? "(missing)"}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = createPrismaClient(databaseUrl);

  try {
    const options = parseOptions(rawArgs);

    if (command === "create") {
      await createCoworkerApiKey(prisma, options);
      return;
    }

    await revokeCoworkerApiKey(prisma, options);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown error while running command",
  );
  process.exit(1);
});
