import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { internalServerError } from "@/helpers/error";

export interface MpsSellerCredentialContext {
  bindingId: string;
  coworkerId: string;
  vendorId: string;
  network: "Preprod" | "Mainnet";
  apiUrl: string;
  agentIdentifier: string;
  walletId: string;
  paymentSourceId: string;
  apiKeyId: string;
}

const VERSION = 1;
const PURPOSE = "sokosumi-mps-seller-credential";
const CONFIG_ERROR = "MPS seller encryption configuration is invalid";
const CREDENTIAL_ERROR = "MPS seller credential operation failed";
const MAX_CONFIG_BYTES = 16_384;
const MAX_ENVELOPE_BYTES = 8_192;
const MAX_CREDENTIAL_BYTES = 4_096;
const MAX_CONTEXT_FIELD_BYTES = 2_048;
const MAX_KEYS = 16;
const CONTEXT_FIELDS = [
  "bindingId",
  "coworkerId",
  "vendorId",
  "network",
  "apiUrl",
  "agentIdentifier",
  "walletId",
  "paymentSourceId",
  "apiKeyId",
] as const satisfies readonly (keyof MpsSellerCredentialContext)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function isBoundedString(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxBytes &&
    Buffer.byteLength(value, "utf8") <= maxBytes
  );
}

function isKeyId(value: unknown): value is string {
  return (
    isBoundedString(value, 64) &&
    /^[A-Za-z0-9]/u.test(value) &&
    !/[^A-Za-z0-9._-]/u.test(value)
  );
}

function parseObject(text: string, maxBytes: number): Record<string, unknown> {
  if (!isBoundedString(text, maxBytes)) {
    throw internalServerError(CREDENTIAL_ERROR);
  }
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw internalServerError(CREDENTIAL_ERROR);
  }

  return value;
}

function decodeBase64(value: unknown, maxBytes: number): Buffer {
  if (!isBoundedString(value, 4 * Math.ceil(maxBytes / 3))) {
    throw internalServerError(CREDENTIAL_ERROR);
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > maxBytes ||
    bytes.toString("base64") !== value
  ) {
    throw internalServerError(CREDENTIAL_ERROR);
  }
  return bytes;
}

function additionalData(
  keyId: string,
  context: MpsSellerCredentialContext,
): Buffer {
  if (
    !isRecord(context) ||
    !hasFields(context, CONTEXT_FIELDS) ||
    !CONTEXT_FIELDS.every((field) =>
      isBoundedString(context[field], MAX_CONTEXT_FIELD_BYTES),
    ) ||
    (context.network !== "Preprod" && context.network !== "Mainnet")
  ) {
    throw internalServerError(CREDENTIAL_ERROR);
  }
  return Buffer.from(
    JSON.stringify([
      PURPOSE,
      VERSION,
      keyId,
      ...CONTEXT_FIELDS.map((field) => context[field]),
    ]),
    "utf8",
  );
}

export function createMpsSellerCredentialCipher(config: string) {
  let activeKeyId: string;
  const keys = new Map<string, Buffer>();
  try {
    const parsed = parseObject(config, MAX_CONFIG_BYTES);
    if (
      !hasFields(parsed, ["activeKeyId", "keys"]) ||
      !isKeyId(parsed.activeKeyId) ||
      !isRecord(parsed.keys)
    ) {
      throw internalServerError(CONFIG_ERROR);
    }
    const entries = Object.entries(parsed.keys);
    if (entries.length === 0 || entries.length > MAX_KEYS) {
      throw internalServerError(CONFIG_ERROR);
    }
    for (const [keyId, encodedKey] of entries) {
      const key = decodeBase64(encodedKey, 32);
      if (!isKeyId(keyId) || key.length !== 32) {
        throw internalServerError(CONFIG_ERROR);
      }
      keys.set(keyId, key);
    }
    activeKeyId = parsed.activeKeyId;
    if (!keys.has(activeKeyId)) {
      throw internalServerError(CONFIG_ERROR);
    }
  } catch {
    throw internalServerError(CONFIG_ERROR);
  }

  return {
    encrypt(plaintext: string, context: MpsSellerCredentialContext): string {
      try {
        if (!isBoundedString(plaintext, MAX_CREDENTIAL_BYTES)) {
          throw internalServerError(CREDENTIAL_ERROR);
        }
        const bytes = Buffer.from(plaintext, "utf8");
        if (bytes.toString("utf8") !== plaintext) {
          throw internalServerError(CREDENTIAL_ERROR);
        }
        const key = keys.get(activeKeyId);
        if (!key) {
          throw internalServerError(CREDENTIAL_ERROR);
        }
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, nonce, {
          authTagLength: 16,
        });
        cipher.setAAD(additionalData(activeKeyId, context));
        const ciphertext = Buffer.concat([
          cipher.update(bytes),
          cipher.final(),
        ]);
        return JSON.stringify({
          version: VERSION,
          keyId: activeKeyId,
          nonce: nonce.toString("base64"),
          ciphertext: ciphertext.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        });
      } catch {
        throw internalServerError(CREDENTIAL_ERROR);
      }
    },

    decrypt(envelope: string, context: MpsSellerCredentialContext): string {
      try {
        const parsed = parseObject(envelope, MAX_ENVELOPE_BYTES);
        if (
          !hasFields(parsed, [
            "version",
            "keyId",
            "nonce",
            "ciphertext",
            "tag",
          ]) ||
          parsed.version !== VERSION ||
          !isKeyId(parsed.keyId)
        ) {
          throw internalServerError(CREDENTIAL_ERROR);
        }
        const key = keys.get(parsed.keyId);
        const nonce = decodeBase64(parsed.nonce, 12);
        const tag = decodeBase64(parsed.tag, 16);
        const ciphertext = decodeBase64(
          parsed.ciphertext,
          MAX_CREDENTIAL_BYTES,
        );
        if (!key || nonce.length !== 12 || tag.length !== 16) {
          throw internalServerError(CREDENTIAL_ERROR);
        }
        const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
          authTagLength: 16,
        });
        decipher.setAAD(additionalData(parsed.keyId, context));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(plaintext);
      } catch {
        throw internalServerError(CREDENTIAL_ERROR);
      }
    },
  };
}
