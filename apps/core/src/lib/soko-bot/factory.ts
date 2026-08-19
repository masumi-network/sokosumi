import type { SokoBotRuntime } from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { EveHttpSokoBotRuntime } from "@/lib/soko-bot/eve-http-runtime";
import { InMemorySokoBotRuntime } from "@/lib/soko-bot/in-memory-runtime";
import {
  type SokoBotSigningKey,
  SokoBotTokenService,
} from "@/lib/soko-bot/request-token";

let runtime: SokoBotRuntime | null = null;
let tokenService: Promise<SokoBotTokenService> | null = null;

function normalizePem(value: string): string {
  return value.replaceAll("\\n", "\n").trim();
}

function parsePreviousKeys(raw: string): SokoBotSigningKey[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("SOKO_BOT_PREVIOUS_PUBLIC_KEYS must be a JSON array");
  }
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid previous Soko Bot public key");
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.keyId !== "string" ||
      typeof record.publicKeyPem !== "string"
    ) {
      throw new Error("Invalid previous Soko Bot public key");
    }
    return {
      keyId: record.keyId,
      publicKeyPem: normalizePem(record.publicKeyPem),
    };
  });
}

export function getSokoBotRuntime(): SokoBotRuntime {
  if (runtime) return runtime;
  const env = getEnv();
  const isDeployedEnvironment =
    process.env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview";
  if (
    isDeployedEnvironment &&
    env.SOKO_BOT_ENABLED &&
    env.SOKO_BOT_RUNTIME_ADAPTER !== "eve"
  ) {
    throw new Error(
      "SOKO_BOT_RUNTIME_ADAPTER must be eve when Soko Bot is enabled in production",
    );
  }
  runtime =
    env.SOKO_BOT_RUNTIME_ADAPTER === "eve"
      ? new EveHttpSokoBotRuntime(
          env.SOKO_BOT_RUNTIME_BASE_URL,
          env.SOKO_BOT_RUNTIME_VERSION,
        )
      : new InMemorySokoBotRuntime();
  return runtime;
}

export function getSokoBotTokenService(): Promise<SokoBotTokenService> {
  if (tokenService) return tokenService;
  const env = getEnv();
  if (!env.SOKO_BOT_SIGNING_PRIVATE_KEY) {
    throw new Error(
      "SOKO_BOT_SIGNING_PRIVATE_KEY is required for Soko Bot turns",
    );
  }
  tokenService = SokoBotTokenService.create({
    issuer: env.BETTER_AUTH_URL,
    requestAudience: "soko-bot-runtime",
    grantAudience: "soko-bot-core",
    currentKeyId: env.SOKO_BOT_SIGNING_KEY_ID,
    privateKeyPem: normalizePem(env.SOKO_BOT_SIGNING_PRIVATE_KEY),
    previousPublicKeys: parsePreviousKeys(env.SOKO_BOT_PREVIOUS_PUBLIC_KEYS),
  });
  return tokenService;
}
