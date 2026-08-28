/**
 * Masks env-sourced secrets in text that leaves this process.
 *
 * The need is not hypothetical. `extractNodeErrorMessage` falls back to a
 * JSON dump of whatever the far side sent, by design, so that no detail is
 * lost from logs. A proxy or gateway in front of an upstream service can
 * answer with a debug body that echoes the request headers, and those headers
 * carry the very API key used to reach it. That string then travels to stdout
 * and to Sentry, which retains it far longer than an operator log.
 *
 * Redaction is by VALUE, not by field name, because the secret arrives inside
 * free text that no schema describes. It is a net, not the first line of
 * defence: the first line is still choosing what to log.
 */

/**
 * Env var names whose values must never appear in outbound text. Matching on
 * the name suffix rather than a hand-kept list means a newly added credential
 * is covered the day it is introduced, which a list would not be.
 */
const SECRET_NAME_PATTERN = /(?:_KEY|_SECRET|_TOKEN|_PASSWORD)$/;

/** `BLOB_WEBHOOK_PUBLIC_KEY` and friends are publishable and must stay readable. */
const PUBLIC_NAME_PATTERN = /PUBLIC/;

/**
 * Short values are more likely to be a placeholder that happens to sit in a
 * secret-named variable ("local-test", "changeme") than real key material,
 * and masking one of those blanks out unrelated log text wherever the same
 * word appears. Real credentials clear this comfortably; anything under it is
 * too weak to be protecting much. This is a net behind deliberate logging,
 * not the control that keeps secrets out of messages.
 */
const MIN_SECRET_LENGTH = 16;

/** How deep to walk a Sentry event. Deeper than any real event nests. */
const MAX_REDACTION_DEPTH = 8;

export const REDACTED_SECRET = "[redacted:env-secret]";

/**
 * Secret values present in `env`, longest first so that a secret containing
 * another is masked whole rather than leaving its tail behind.
 */
export function collectEnvSecrets(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const secrets = new Set<string>();

  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < MIN_SECRET_LENGTH) {
      continue;
    }
    if (PUBLIC_NAME_PATTERN.test(name) || !SECRET_NAME_PATTERN.test(name)) {
      continue;
    }
    secrets.add(value);
  }

  return Array.from(secrets).sort((a, b) => b.length - a.length);
}

let cachedEnvSecrets: string[] | null = null;

/**
 * {@link collectEnvSecrets} over the live environment, computed once.
 *
 * `process.env` does not change after boot, and the callers are on logging
 * paths that must not pay for a full scan of it per line.
 */
export function getEnvSecrets(): string[] {
  if (cachedEnvSecrets === null) {
    cachedEnvSecrets = collectEnvSecrets();
  }
  return cachedEnvSecrets;
}

/**
 * Replaces every occurrence of every secret in `text`.
 *
 * Split and join rather than a RegExp: key material can contain regex
 * metacharacters, and building a pattern out of an untrusted-shaped value is
 * how a redactor silently stops matching.
 */
export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let redacted = text;

  for (const secret of secrets) {
    if (redacted.includes(secret)) {
      redacted = redacted.split(secret).join(REDACTED_SECRET);
    }
  }

  return redacted;
}

/**
 * Applies {@link redactSecrets} to every string reachable in `value`.
 *
 * Copies rather than mutating: the input can be an object the caller still
 * owns. Values that are not strings, arrays, or plain objects are returned
 * untouched, so a Sentry event's non-serializable metadata survives intact.
 */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) {
    return value;
  }
  return walk(value, secrets, 0, new WeakSet<object>()) as T;
}

function walk(
  value: unknown,
  secrets: readonly string[],
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, secrets);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_REDACTION_DEPTH || seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, secrets, depth + 1, seen));
  }
  // Anything with a custom prototype (a Date, a Buffer, a class instance) is
  // left alone: rebuilding it as a plain object would corrupt the event.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = walk(item, secrets, depth + 1, seen);
  }
  return redacted;
}
