import {
  COWORKER_API_KEY_PREFIX,
  rejectCoworkerApiKey,
  USER_API_KEY_PREFIX_BY_TARGET,
} from "./config.js";

export type CredentialActor = "developer" | "coworker" | "unknown";

export type InvocationSurface = "developer-cli" | "runtime";

export type CoworkerLifetime =
  | "session-only"
  | "retained"
  | "persistent-hosted";

export type SecretDeliveryMode = "session-memory" | "os-vault";

/**
 * Classify a bearer API key by reserved prefix.
 * OAuth access tokens are not API keys; callers treat them as developer auth.
 */
export function classifyApiKeyActor(apiKey: string): CredentialActor {
  const trimmed = apiKey.trim();
  if (!trimmed) return "unknown";
  if (trimmed.startsWith(COWORKER_API_KEY_PREFIX)) return "coworker";
  if (
    trimmed.startsWith(USER_API_KEY_PREFIX_BY_TARGET.mainnet) ||
    trimmed.startsWith(USER_API_KEY_PREFIX_BY_TARGET.preprod)
  ) {
    return "developer";
  }
  return "unknown";
}

/**
 * Enforce which actor may call which surface (ADR 0005).
 * Developer CLI rejects `coworker_*` before Core (V58).
 * Runtime work accepts only `coworker_*` (V66, V77).
 */
export function assertActorForSurface(
  actor: CredentialActor,
  surface: InvocationSurface,
): void {
  if (surface === "developer-cli" && actor === "coworker") {
    throw new Error("Coworker API keys are not supported by the CLI");
  }
  if (surface === "runtime" && actor !== "coworker") {
    throw new Error(
      "Runtime Core calls require a coworker_* API key; developer credentials are not allowed",
    );
  }
}

export function assertDeveloperCliApiKey(apiKey: string): void {
  rejectCoworkerApiKey(apiKey);
  assertActorForSurface(classifyApiKeyActor(apiKey), "developer-cli");
}

export function assertRuntimeApiKey(apiKey: string): void {
  assertActorForSurface(classifyApiKeyActor(apiKey), "runtime");
}

export function secretDeliveryModeForLifetime(
  lifetime: CoworkerLifetime,
): SecretDeliveryMode {
  return lifetime === "session-only" ? "session-memory" : "os-vault";
}

/** Session expiry removes temporary authority only (ADR 0005 §4). */
export function sessionExpiryDeletesCoworkerIdentity(): boolean {
  return false;
}

/** Runtime must not mint or rotate its own `coworker_*` key (ADR 0005 §7). */
export function runtimeMaySelfMintCoworkerKey(): boolean {
  return false;
}

/**
 * Shared CLI/TUI/skill handlers must not shell out to the CLI entrypoint
 * (ADR 0005 §8).
 */
export function recursiveCliInvocationAllowed(): boolean {
  return false;
}
