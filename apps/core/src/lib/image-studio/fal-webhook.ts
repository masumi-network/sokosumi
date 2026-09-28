import crypto from "node:crypto";

/**
 * ED25519 verification for fal webhook deliveries.
 *
 * Reference: https://fal.ai/docs/model-endpoints/webhooks
 *
 * The signed message is four values joined by newlines:
 *   request id, user id, timestamp, hex sha256 of the raw body.
 *
 * The raw body must be the exact bytes fal sent. Verifying a re-serialized
 * object would verify our own JSON round-trip, not fal's payload, and would
 * pass for a body we had already altered.
 */

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const JWKS_CACHE_MS = 24 * 60 * 60 * 1000;
/** fal's documented replay window. */
export const TIMESTAMP_LEEWAY_SECONDS = 300;

export interface FalWebhookHeaders {
  requestId: string | null;
  userId: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function readWebhookHeaders(headers: Headers): FalWebhookHeaders {
  return {
    requestId: headers.get("x-fal-webhook-request-id"),
    userId: headers.get("x-fal-webhook-user-id"),
    timestamp: headers.get("x-fal-webhook-timestamp"),
    signature: headers.get("x-fal-webhook-signature"),
  };
}

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

interface JwksCache {
  keys: crypto.KeyObject[];
  fetchedAt: number;
}

let cache: JwksCache | null = null;

/** Exposed for tests; production callers never need it. */
export function resetJwksCacheForTests(): void {
  cache = null;
}

async function loadPublicKeys(
  fetchImpl: typeof fetch,
  now: number,
): Promise<crypto.KeyObject[]> {
  if (cache && now - cache.fetchedAt < JWKS_CACHE_MS) return cache.keys;
  const response = await fetchImpl(JWKS_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`fal JWKS fetch failed (${response.status})`);
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new Error("fal JWKS has no keys");

  const keys: crypto.KeyObject[] = [];
  for (const entry of body.keys) {
    if (typeof entry !== "object" || entry === null) continue;
    const { x } = entry as { x?: unknown };
    if (typeof x !== "string") continue;
    try {
      keys.push(
        crypto.createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x },
          format: "jwk",
        }),
      );
    } catch {
      // A key we cannot parse is not a reason to reject a delivery another
      // key can verify.
    }
  }
  if (keys.length === 0) throw new Error("fal JWKS had no usable Ed25519 key");
  cache = { keys, fetchedAt: now };
  return keys;
}

/**
 * @param rawBody The exact bytes received, not a re-encoded object.
 */
export async function verifyFalWebhook(options: {
  headers: FalWebhookHeaders;
  rawBody: Uint8Array;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<WebhookVerification> {
  const { requestId, userId, timestamp, signature } = options.headers;
  if (!requestId || !userId || !timestamp || !signature) {
    return { ok: false, reason: "missing_headers" };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - sentAt) > TIMESTAMP_LEEWAY_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, "hex");
    if (signatureBytes.length === 0) throw new Error("empty");
  } catch {
    return { ok: false, reason: "bad_signature_encoding" };
  }

  const bodyHash = crypto
    .createHash("sha256")
    .update(options.rawBody)
    .digest("hex");
  const message = Buffer.from(
    [requestId, userId, timestamp, bodyHash].join("\n"),
    "utf8",
  );

  let keys: crypto.KeyObject[];
  try {
    keys = await loadPublicKeys(options.fetchImpl ?? fetch, Date.now());
  } catch (error) {
    // Failing closed is the only safe choice: we cannot tell a forged delivery
    // from a real one without the keys.
    return {
      ok: false,
      reason: error instanceof Error ? `jwks:${error.message}` : "jwks",
    };
  }

  for (const key of keys) {
    try {
      if (crypto.verify(null, message, key, signatureBytes))
        return { ok: true };
    } catch {
      // Try the next key.
    }
  }
  return { ok: false, reason: "signature_mismatch" };
}
