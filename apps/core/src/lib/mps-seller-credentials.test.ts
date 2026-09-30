import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createMpsSellerCredentialCipher,
  type MpsSellerCredentialContext,
} from "./mps-seller-credentials";

const KEY_ONE = Buffer.alloc(32, 17).toString("base64");
const KEY_TWO = Buffer.alloc(32, 34).toString("base64");
const CREDENTIAL = 'fixture-seller-key-with-"quotes"-and-\\slashes';
const CONFIG_ERROR = "MPS seller encryption configuration is invalid";
const CREDENTIAL_ERROR = "MPS seller credential operation failed";
const CONTEXT: MpsSellerCredentialContext = {
  bindingId: "binding-original",
  coworkerId: "coworker-original",
  vendorId: "vendor-original",
  network: "Preprod",
  apiUrl: "https://seller.example/mps/",
  agentIdentifier: "agent-original",
  walletId: "wallet-original",
  paymentSourceId: "payment-source-original",
  apiKeyId: "api-key-original",
};

function config(
  activeKeyId = "first",
  keys: Record<string, string> = { first: KEY_ONE },
): string {
  return JSON.stringify({ activeKeyId, keys });
}

function expectSafeError(operation: () => unknown, message: string): void {
  try {
    operation();
    expect.unreachable("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("message", message);
    expect(error).toHaveProperty("cause", undefined);
    for (const value of [
      CREDENTIAL,
      KEY_ONE,
      KEY_TWO,
      ...Object.values(CONTEXT),
    ]) {
      expect(String(error)).not.toContain(value);
      expect(JSON.stringify(error)).not.toContain(value);
    }
  }
}

function changeEnvelope(
  envelope: string,
  fields: Record<string, unknown>,
): string {
  return JSON.stringify({ ...JSON.parse(envelope), ...fields });
}

function changeByte(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

describe("MPS seller credentials", () => {
  it("encrypts without exposing credentials, keys, or seller context", () => {
    const cipher = createMpsSellerCredentialCipher(config());
    const envelope = cipher.encrypt(CREDENTIAL, CONTEXT);

    expect(cipher.decrypt(envelope, CONTEXT)).toBe(CREDENTIAL);
    expect(JSON.parse(envelope)).toMatchObject({ version: 1, keyId: "first" });
    for (const value of [CREDENTIAL, KEY_ONE, ...Object.values(CONTEXT)]) {
      expect(envelope).not.toContain(value);
    }
  });

  it("uses a fresh nonce for repeated encryption", () => {
    const cipher = createMpsSellerCredentialCipher(config());
    const first = JSON.parse(cipher.encrypt(CREDENTIAL, CONTEXT));
    const second = JSON.parse(cipher.encrypt(CREDENTIAL, CONTEXT));

    expect(Buffer.from(first.nonce, "base64")).toHaveLength(12);
    expect(Buffer.from(first.tag, "base64")).toHaveLength(16);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("reads retained keys after rotation and writes with the active key", () => {
    const before = createMpsSellerCredentialCipher(config());
    const oldEnvelope = before.encrypt(CREDENTIAL, CONTEXT);
    const after = createMpsSellerCredentialCipher(
      config("second", { first: KEY_ONE, second: KEY_TWO }),
    );

    expect(after.decrypt(oldEnvelope, CONTEXT)).toBe(CREDENTIAL);
    const newEnvelope = after.encrypt(CREDENTIAL, CONTEXT);
    expect(JSON.parse(newEnvelope).keyId).toBe("second");
    expect(after.decrypt(newEnvelope, CONTEXT)).toBe(CREDENTIAL);
    expectSafeError(
      () => before.decrypt(newEnvelope, CONTEXT),
      CREDENTIAL_ERROR,
    );
    const retired = createMpsSellerCredentialCipher(
      config("second", { second: KEY_TWO }),
    );
    expectSafeError(
      () => retired.decrypt(oldEnvelope, CONTEXT),
      CREDENTIAL_ERROR,
    );
  });

  it.each(Object.keys(CONTEXT) as (keyof MpsSellerCredentialContext)[])(
    "rejects a changed %s binding",
    (field) => {
      const cipher = createMpsSellerCredentialCipher(config());
      const envelope = cipher.encrypt(CREDENTIAL, CONTEXT);
      const changed = {
        ...CONTEXT,
        [field]: field === "network" ? "Mainnet" : "different",
      };
      expectSafeError(
        () => cipher.decrypt(envelope, changed),
        CREDENTIAL_ERROR,
      );
    },
  );

  it("binds the key ID even when two IDs contain the same key", () => {
    const cipher = createMpsSellerCredentialCipher(
      config("first", { first: KEY_ONE, alias: KEY_ONE }),
    );
    const envelope = cipher.encrypt(CREDENTIAL, CONTEXT);
    expectSafeError(
      () =>
        cipher.decrypt(changeEnvelope(envelope, { keyId: "alias" }), CONTEXT),
      CREDENTIAL_ERROR,
    );
  });

  it("rejects replacement key material under the same key ID", () => {
    const envelope = createMpsSellerCredentialCipher(config()).encrypt(
      CREDENTIAL,
      CONTEXT,
    );
    const replaced = createMpsSellerCredentialCipher(
      config("first", { first: KEY_TWO }),
    );
    expectSafeError(
      () => replaced.decrypt(envelope, CONTEXT),
      CREDENTIAL_ERROR,
    );
  });

  it.each(["nonce", "ciphertext", "tag"])(
    "rejects changed %s bytes",
    (field) => {
      const cipher = createMpsSellerCredentialCipher(config());
      const envelope = cipher.encrypt(CREDENTIAL, CONTEXT);
      expectSafeError(
        () =>
          cipher.decrypt(
            changeEnvelope(envelope, {
              [field]: changeByte(JSON.parse(envelope)[field]),
            }),
            CONTEXT,
          ),
        CREDENTIAL_ERROR,
      );
    },
  );

  it.each([
    ["empty", ""],
    ["malformed JSON", `{"activeKeyId":"${CREDENTIAL}`],
    ["array", "[]"],
    ["null", "null"],
    ["missing key ring", JSON.stringify({ activeKeyId: "first" })],
    [
      "extra field",
      JSON.stringify({
        activeKeyId: "first",
        keys: { first: KEY_ONE },
        secret: CREDENTIAL,
      }),
    ],
    ["missing active key", config("absent")],
    ["empty ring", config("first", {})],
    [
      "too many keys",
      config(
        "key0",
        Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => [`key${index}`, KEY_ONE]),
        ),
      ),
    ],
    ["invalid key ID", config("bad\n", { "bad\n": KEY_ONE })],
    ["long key ID", config("a".repeat(65), { ["a".repeat(65)]: KEY_ONE })],
    [
      "invalid retained key",
      config("first", { first: KEY_ONE, "invalid key": KEY_TWO }),
    ],
    [
      "non-string key",
      JSON.stringify({ activeKeyId: "first", keys: { first: 42 } }),
    ],
    [
      "short key",
      config("first", { first: Buffer.alloc(31).toString("base64") }),
    ],
    [
      "long key",
      config("first", { first: Buffer.alloc(33).toString("base64") }),
    ],
    ["unpadded base64", config("first", { first: KEY_ONE.replace(/=$/u, "") })],
    ["base64 whitespace", config("first", { first: `${KEY_ONE}\n` })],
    [
      "noncanonical base64",
      config("first", { first: `${KEY_ONE.slice(0, -2)}F=` }),
    ],
    ["oversized", " ".repeat(16_385)],
  ])("rejects %s configuration without exposing input", (_name, value) => {
    expectSafeError(() => createMpsSellerCredentialCipher(value), CONFIG_ERROR);
  });

  it.each([
    ["version", { version: 2 }],
    ["string version", { version: "1" }],
    ["unknown key ID", { keyId: "missing" }],
    ["extra property", { secret: CREDENTIAL }],
    ["missing tag", { tag: undefined }],
    ["short tag", { tag: Buffer.alloc(15).toString("base64") }],
    ["long tag", { tag: Buffer.alloc(17).toString("base64") }],
    ["short nonce", { nonce: Buffer.alloc(11).toString("base64") }],
    ["long nonce", { nonce: Buffer.alloc(13).toString("base64") }],
    ["empty ciphertext", { ciphertext: "" }],
    ["non-string ciphertext", { ciphertext: 123 }],
    [
      "large ciphertext",
      { ciphertext: Buffer.alloc(4_097).toString("base64") },
    ],
    ["invalid base64", { ciphertext: "!!!!" }],
  ])("rejects envelope with %s", (_name, fields) => {
    const cipher = createMpsSellerCredentialCipher(config());
    const envelope = cipher.encrypt(CREDENTIAL, CONTEXT);
    expectSafeError(
      () => cipher.decrypt(changeEnvelope(envelope, fields), CONTEXT),
      CREDENTIAL_ERROR,
    );
  });

  it.each(["", "null", "[]", CREDENTIAL, " ".repeat(8_193)])(
    "rejects malformed envelope %# without forwarding it",
    (envelope) => {
      const cipher = createMpsSellerCredentialCipher(config());
      expectSafeError(
        () => cipher.decrypt(envelope, CONTEXT),
        CREDENTIAL_ERROR,
      );
    },
  );

  it.each(["", "x".repeat(4_097), "é".repeat(2_049), "\ud800"])(
    "rejects invalid plaintext %#",
    (plaintext) => {
      const cipher = createMpsSellerCredentialCipher(config());
      expectSafeError(
        () => cipher.encrypt(plaintext, CONTEXT),
        CREDENTIAL_ERROR,
      );
    },
  );

  it.each(["é".repeat(2_048), "\ufeffcredential"])(
    "preserves Unicode and the size boundary %#",
    (plaintext) => {
      const cipher = createMpsSellerCredentialCipher(config());
      expect(cipher.decrypt(cipher.encrypt(plaintext, CONTEXT), CONTEXT)).toBe(
        plaintext,
      );
    },
  );

  it.each([
    null,
    {},
    { ...CONTEXT, apiKeyId: undefined },
    { ...CONTEXT, walletId: "" },
    { ...CONTEXT, network: "unknown" },
    { ...CONTEXT, apiUrl: "x".repeat(2_049) },
    { ...CONTEXT, vendorId: 42 },
    { ...CONTEXT, extra: "unexpected" },
  ])("rejects malformed context %# on encrypt and decrypt", (context) => {
    const cipher = createMpsSellerCredentialCipher(config());
    const envelope = cipher.encrypt(CREDENTIAL, CONTEXT);
    const invalidContext = context as MpsSellerCredentialContext;
    expectSafeError(
      () => cipher.encrypt(CREDENTIAL, invalidContext),
      CREDENTIAL_ERROR,
    );
    expectSafeError(
      () => cipher.decrypt(envelope, invalidContext),
      CREDENTIAL_ERROR,
    );
  });

  it("rejects authenticated bytes that are not UTF-8", () => {
    const nonce = Buffer.alloc(12, 3);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(KEY_ONE, "base64"),
      nonce,
      { authTagLength: 16 },
    );
    cipher.setAAD(
      Buffer.from(
        JSON.stringify([
          "sokosumi-mps-seller-credential",
          1,
          "first",
          ...Object.values(CONTEXT),
        ]),
      ),
    );
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from([0xff])),
      cipher.final(),
    ]);
    const envelope = JSON.stringify({
      version: 1,
      keyId: "first",
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    });
    expectSafeError(
      () =>
        createMpsSellerCredentialCipher(config()).decrypt(envelope, CONTEXT),
      CREDENTIAL_ERROR,
    );
  });
});
