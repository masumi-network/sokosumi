#!/usr/bin/env node
// Writes scripts/buzz-local/.env for a local Buzz relay (plus an isolated
// Sokosumi Postgres) and prints the Core settings that point at it.
// Run from apps/core so `nostr-tools` resolves: node ../../scripts/buzz-local/setup.mjs
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const { generateSecretKey, getPublicKey } = require("nostr-tools/pure");
const bytesToHex = (bytes) => Buffer.from(bytes).toString("hex");

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, ".env");
const port = process.env.BUZZ_HTTP_PORT ?? "3400";
const hex = (n) => randomBytes(n).toString("hex");

if (!existsSync(envPath)) {
  const operator = generateSecretKey();
  const relay = generateSecretKey();
  const lines = {
    BUZZ_IMAGE: "ghcr.io/block/buzz:main",
    BUZZ_DOMAIN: `localhost:${port}`,
    RELAY_URL: `ws://localhost:${port}`,
    BUZZ_MEDIA_BASE_URL: `http://localhost:${port}/media`,
    BUZZ_MEDIA_SERVER_DOMAIN: `localhost:${port}`,
    BUZZ_CORS_ORIGINS:
      "http://localhost:3000,http://localhost:3010,http://localhost:1420,tauri://localhost",
    BUZZ_REQUIRE_AUTH_TOKEN: "false",
    BUZZ_REQUIRE_RELAY_MEMBERSHIP: "true",
    BUZZ_ALLOW_NIP_OA_AUTH: "true",
    BUZZ_AUTO_MIGRATE: "true",
    BUZZ_GIT_CONFORMANCE_PROBE: "false",
    BUZZ_PUSH_ENABLED: "false",
    RUST_LOG: "buzz_relay=info,buzz_db=warn,buzz_auth=info",
    RELAY_OWNER_PUBKEY: getPublicKey(operator),
    BUZZ_RELAY_PRIVATE_KEY: bytesToHex(relay),
    BUZZ_GIT_HOOK_HMAC_SECRET: hex(32),
    POSTGRES_DB: "buzz",
    POSTGRES_USER: "buzz",
    POSTGRES_PASSWORD: hex(16),
    REDIS_PASSWORD: hex(16),
    BUZZ_S3_ACCESS_KEY: hex(10),
    BUZZ_S3_SECRET_KEY: hex(20),
    BUZZ_S3_BUCKET: "buzz-media",
    BUZZ_S3_ADDRESSING_STYLE: "path",
    BUZZ_HTTP_PORT: port,
    SOKOSUMI_DB_PASSWORD: hex(16),
    SOKOSUMI_DB_PORT: "5434",
    // Not read by the relay: the key Core signs operator events with.
    SOKOSUMI_BUZZ_OPERATOR_SECRET_KEY: bytesToHex(operator),
  };
  writeFileSync(
    envPath,
    Object.entries(lines)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  console.log(`wrote ${envPath}`);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
console.log(`\nAdd to apps/core/.env (see scripts/buzz-local/README.md):
BUZZ_RELAY_URL=${env.RELAY_URL}
BUZZ_OPERATOR_SECRET_KEY=<SOKOSUMI_BUZZ_OPERATOR_SECRET_KEY from scripts/buzz-local/.env>
BUZZ_KEY_ENCRYPTION_SECRET=<any 32+ character secret>
DATABASE_URL=postgresql://sokosumi:<SOKOSUMI_DB_PASSWORD>@localhost:${env.SOKOSUMI_DB_PORT}/sokosumi`);
