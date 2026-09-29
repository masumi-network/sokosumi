import { createCoworkerHttpClient } from "../api/http-client.js";
import {
  type CredentialStore,
  createCredentialStore,
} from "../auth/secure-store.js";

export interface RuntimeCredential {
  apiKey: string;
}

type RuntimeStoreOptions = Pick<
  NonNullable<Parameters<typeof createCredentialStore>[0]>,
  "platform" | "entryFactory"
>;

function validateCoworkerId(coworkerId: string): void {
  if (
    typeof coworkerId !== "string" ||
    !coworkerId ||
    /\s/u.test(coworkerId) ||
    Buffer.from(coworkerId, "utf8").toString("utf8") !== coworkerId
  ) {
    throw new Error("Coworker ID is invalid");
  }
}

function validateKey(apiKey: unknown): string {
  if (typeof apiKey !== "string") {
    throw new Error("Runtime credential requires a coworker_* API key");
  }
  createCoworkerHttpClient({ apiKey });
  return apiKey;
}

function vaultError(): Error {
  return new Error(
    "OS credential vault is unavailable. Supply the Coworker key through --api-key-stdin from an operator-controlled secret reader.",
  );
}

export function createRuntimeCredentialStore(
  coworkerId: string,
  options: RuntimeStoreOptions = {},
): CredentialStore<RuntimeCredential> {
  validateCoworkerId(coworkerId);
  try {
    return createCredentialStore<RuntimeCredential>({
      ...options,
      serviceName: "sokosumi-coworker-runtime",
      accountName: `preprod:${Buffer.from(coworkerId, "utf8").toString("hex")}`,
    });
  } catch {
    throw vaultError();
  }
}

export function parseRuntimeKeyInput(
  input: string,
  coworkerId: string,
): string {
  validateCoworkerId(coworkerId);
  if (Buffer.byteLength(input, "utf8") > 16_384) {
    throw new Error("Runtime key input is too large");
  }
  const text = input.trim();
  if (!text.startsWith("{")) return validateKey(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "Runtime key input must contain a Coworker key or its CLI JSON output",
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("coworkerId" in parsed) ||
    parsed.coworkerId !== coworkerId
  ) {
    throw new Error("Runtime key input belongs to a different Coworker");
  }
  if (
    !("apiKey" in parsed) ||
    !parsed.apiKey ||
    typeof parsed.apiKey !== "object" ||
    Array.isArray(parsed.apiKey) ||
    !("token" in parsed.apiKey)
  ) {
    throw new Error("Runtime key JSON requires apiKey.token");
  }
  return validateKey(parsed.apiKey.token);
}

export function readRuntimeCredential(
  coworkerId: string,
  store?: CredentialStore<RuntimeCredential>,
): string {
  validateCoworkerId(coworkerId);
  let credential: unknown;
  try {
    const runtimeStore = store ?? createRuntimeCredentialStore(coworkerId);
    if (runtimeStore.isSupported === false) throw vaultError();
    credential = runtimeStore.read();
  } catch {
    throw vaultError();
  }
  if (!credential) {
    throw new Error(
      "No runtime key is stored for this Coworker. Use runtime key-import or supply --api-key-stdin.",
    );
  }
  if (
    typeof credential !== "object" ||
    Array.isArray(credential) ||
    !("apiKey" in credential)
  ) {
    throw new Error("Stored runtime credential requires a coworker_* API key");
  }
  return validateKey(credential.apiKey);
}

export function saveRuntimeCredential(
  coworkerId: string,
  apiKey: string,
  store?: CredentialStore<RuntimeCredential>,
): void {
  validateCoworkerId(coworkerId);
  validateKey(apiKey);
  try {
    const runtimeStore = store ?? createRuntimeCredentialStore(coworkerId);
    if (runtimeStore.isSupported === false) throw vaultError();
    runtimeStore.write({ apiKey });
  } catch {
    throw vaultError();
  }
}
