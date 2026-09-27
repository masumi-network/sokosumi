import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readWebhookHeaders,
  resetJwksCacheForTests,
  TIMESTAMP_LEEWAY_SECONDS,
  verifyFalWebhook,
} from "@/lib/image-studio/fal-webhook";

/**
 * A webhook is the one completion path with no session behind it, so the
 * signature is the entire access check. These tests are the proof that a body
 * we did not receive from fal settles nothing.
 */

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const jwk = publicKey.export({ format: "jwk" }) as { x: string };

const REQUEST_ID = "req-1";
const USER_ID = "user-1";
const NOW = new Date("2026-09-25T12:00:00.000Z");

function jwksFetch(
  keys: unknown[] = [{ kty: "OKP", crv: "Ed25519", x: jwk.x }],
) {
  return vi.fn(
    async () => new Response(JSON.stringify({ keys }), { status: 200 }),
  ) as unknown as typeof fetch;
}

function sign(rawBody: Uint8Array, timestamp: string, key = privateKey) {
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const message = Buffer.from(
    [REQUEST_ID, USER_ID, timestamp, bodyHash].join("\n"),
    "utf8",
  );
  return crypto.sign(null, message, key).toString("hex");
}

function headersFor(
  rawBody: Uint8Array,
  overrides: Partial<{
    timestamp: string;
    signature: string;
  }> = {},
) {
  const timestamp =
    overrides.timestamp ?? String(Math.floor(NOW.getTime() / 1000));
  return {
    requestId: REQUEST_ID,
    userId: USER_ID,
    timestamp,
    signature: overrides.signature ?? sign(rawBody, timestamp),
  };
}

describe("fal webhook verification", () => {
  beforeEach(() => {
    resetJwksCacheForTests();
  });

  it("accepts a delivery signed by a published key", async () => {
    const rawBody = new TextEncoder().encode('{"request_id":"req-1"}');
    const result = await verifyFalWebhook({
      headers: headersFor(rawBody),
      rawBody,
      now: NOW,
      fetchImpl: jwksFetch(),
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a body that changed after signing", async () => {
    const signed = new TextEncoder().encode('{"request_id":"req-1"}');
    const headers = headersFor(signed);
    // The attacker keeps the headers and swaps the payload for one naming a
    // different request.
    const tampered = new TextEncoder().encode('{"request_id":"req-999"}');

    const result = await verifyFalWebhook({
      headers,
      rawBody: tampered,
      now: NOW,
      fetchImpl: jwksFetch(),
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a replay from outside the timestamp window", async () => {
    const rawBody = new TextEncoder().encode("{}");
    const stale = String(
      Math.floor(NOW.getTime() / 1000) - TIMESTAMP_LEEWAY_SECONDS - 1,
    );
    const result = await verifyFalWebhook({
      headers: headersFor(rawBody, { timestamp: stale }),
      rawBody,
      now: NOW,
      fetchImpl: jwksFetch(),
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a signature from a key fal does not publish", async () => {
    const other = crypto.generateKeyPairSync("ed25519");
    const rawBody = new TextEncoder().encode("{}");
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    const result = await verifyFalWebhook({
      headers: headersFor(rawBody, {
        timestamp,
        signature: sign(rawBody, timestamp, other.privateKey),
      }),
      rawBody,
      now: NOW,
      fetchImpl: jwksFetch(),
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("fails closed when the key set cannot be read", async () => {
    const rawBody = new TextEncoder().encode("{}");
    const failing = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await verifyFalWebhook({
      headers: headersFor(rawBody),
      rawBody,
      now: NOW,
      fetchImpl: failing,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("jwks");
  });

  it("rejects a delivery with no signature headers at all", async () => {
    const rawBody = new TextEncoder().encode("{}");
    const result = await verifyFalWebhook({
      headers: readWebhookHeaders(new Headers()),
      rawBody,
      now: NOW,
      fetchImpl: jwksFetch(),
    });
    expect(result).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("reads the documented header names", () => {
    const headers = new Headers({
      "x-fal-webhook-request-id": "r",
      "x-fal-webhook-user-id": "u",
      "x-fal-webhook-timestamp": "1",
      "x-fal-webhook-signature": "ab",
    });
    expect(readWebhookHeaders(headers)).toEqual({
      requestId: "r",
      userId: "u",
      timestamp: "1",
      signature: "ab",
    });
  });
});
