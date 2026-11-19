import { hkdfSync } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getEnv } from "@/config/env";

/** What a row stores for one encrypted value (ADR 0074). */
export interface SealedSokoBotSecret {
  ciphertext: string;
  /** Which key wrote `ciphertext`, so a later key can replace this one. */
  keyId: string;
}

const KEY_ID = "auth-v1";

function sealingKey(): string {
  // Derived rather than reused, as the turn token's key is: this key opens
  // nothing Better Auth encrypts, and needs no separate provisioning.
  return Buffer.from(
    hkdfSync(
      "sha256",
      getEnv().BETTER_AUTH_SECRET,
      "sokosumi",
      "soko-bot-secret-v1",
      32,
    ),
  ).toString("hex");
}

export async function sealSokoBotSecret(
  value: string,
): Promise<SealedSokoBotSecret> {
  return {
    ciphertext: await symmetricEncrypt({ key: sealingKey(), data: value }),
    keyId: KEY_ID,
  };
}

/** The value, or a throw when another key or secret wrote the row. */
export async function openSokoBotSecret(
  sealed: SealedSokoBotSecret,
): Promise<string> {
  if (sealed.keyId !== KEY_ID)
    throw new Error(`Unknown Soko Bot secret key ${sealed.keyId}`);
  return symmetricDecrypt({ key: sealingKey(), data: sealed.ciphertext });
}
