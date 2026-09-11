const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS: Record<string, true> = {
  authorization: true,
  accesstoken: true,
  apikey: true,
  authtoken: true,
  clientsecret: true,
  password: true,
  refreshtoken: true,
  secret: true,
  token: true,
};

const CREDENTIAL_ASSIGNMENT =
  /((?:authorization|access[_-]*token|api[_-]*key|auth[_-]*token|client[_-]*secret|password|refresh[_-]*token|secret|token))["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|Bearer\s+\S+|[^\s,;}\]]+)/gi;

function redactString(value: string, knownSecrets: readonly string[]): string {
  let redacted = value;
  for (const secret of knownSecrets) {
    if (secret.length > 0) redacted = redacted.split(secret).join(REDACTED);
  }
  return redacted.replace(CREDENTIAL_ASSIGNMENT, "$1: [REDACTED]");
}

export function redactSensitive(
  value: unknown,
  knownSecrets: readonly string[] = [],
): unknown {
  if (typeof value === "string") return redactString(value, knownSecrets);
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, knownSecrets));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        SENSITIVE_KEYS[key.replace(/[_-]/g, "").toLowerCase()] === true
          ? REDACTED
          : redactSensitive(item, knownSecrets),
      ]),
    );
  }
  return value;
}

export function redactErrorMessage(
  error: unknown,
  knownSecrets: readonly string[] = [],
): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactString(message, knownSecrets);
}
