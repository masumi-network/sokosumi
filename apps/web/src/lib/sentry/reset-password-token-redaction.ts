import type { ErrorEvent } from "@sentry/nextjs";

import {
  RESET_PASSWORD_PATH,
  RESET_PASSWORD_TOKEN_COOKIE_NAME,
} from "@/lib/reset-password-token";

const FILTERED_VALUE = "[Filtered]";

interface SentryEventWithRequest {
  request?: ErrorEvent["request"];
}

interface ResetPasswordScan {
  hasResetPasswordContext: boolean;
  tokens: Set<string>;
}

function isResetPasswordUrl(value: string): boolean {
  try {
    const url = new URL(value, "https://redaction.invalid");
    return (
      url.pathname === RESET_PASSWORD_PATH ||
      url.pathname.startsWith(`${RESET_PASSWORD_PATH}/`)
    );
  } catch {
    return false;
  }
}

function redactTokenFromUrl(value: string): string {
  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  const url = new URL(value, "https://redaction.invalid");
  url.searchParams.delete("token");
  return isAbsolute
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

function redactTokenFromQueryString(
  queryString: NonNullable<ErrorEvent["request"]>["query_string"],
) {
  if (typeof queryString === "string") {
    const params = new URLSearchParams(queryString);
    params.delete("token");
    return params.toString();
  }

  if (Array.isArray(queryString)) {
    return queryString.filter(([key]) => key !== "token");
  }

  if (queryString) {
    const { token: _token, ...safeQuery } = queryString;
    return safeQuery;
  }

  return queryString;
}

function redactResetPasswordHeaders(
  headers: NonNullable<ErrorEvent["request"]>["headers"],
) {
  if (!headers) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === "referer" && isResetPasswordUrl(value)) {
        return [key, redactTokenFromUrl(value)];
      }
      if (normalizedKey === "cookie") {
        return [
          key,
          value
            .split(";")
            .map((cookie) => cookie.trim())
            .filter(
              (cookie) =>
                !cookie.startsWith(`${RESET_PASSWORD_TOKEN_COOKIE_NAME}=`),
            )
            .join("; "),
        ];
      }
      return [key, value];
    }),
  );
}

function redactResetPasswordCookies(
  cookies: NonNullable<ErrorEvent["request"]>["cookies"],
) {
  if (!cookies) {
    return cookies;
  }

  const { [RESET_PASSWORD_TOKEN_COOKIE_NAME]: _token, ...safeCookies } =
    cookies;
  return safeCookies;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addToken(tokens: Set<string>, token: string): void {
  if (token) {
    tokens.add(token);
  }
}

function scanCookieHeader(scan: ResetPasswordScan, value: string): void {
  for (const cookie of value.split(";")) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name === RESET_PASSWORD_TOKEN_COOKIE_NAME) {
      scan.hasResetPasswordContext = true;
      addToken(scan.tokens, parts.join("="));
    }
  }
}

function scanResetPasswordContext(
  value: unknown,
  scan: ResetPasswordScan,
  seen: WeakSet<object>,
): void {
  if (typeof value === "string") {
    if (isResetPasswordUrl(value)) {
      scan.hasResetPasswordContext = true;
      const url = new URL(value, "https://redaction.invalid");
      for (const token of url.searchParams.getAll("token")) {
        addToken(scan.tokens, token);
      }
    }
    return;
  }

  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      scanResetPasswordContext(item, scan, seen);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "sdkProcessingMetadata") {
      continue;
    }
    if (key === RESET_PASSWORD_TOKEN_COOKIE_NAME && typeof child === "string") {
      scan.hasResetPasswordContext = true;
      addToken(scan.tokens, child);
    }
    if (key.toLowerCase() === "cookie" && typeof child === "string") {
      scanCookieHeader(scan, child);
    }
    scanResetPasswordContext(child, scan, seen);
  }
}

function collectNamedTokens(
  value: unknown,
  tokens: Set<string>,
  seen: WeakSet<object>,
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNamedTokens(item, tokens, seen);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "sdkProcessingMetadata") {
      continue;
    }
    if (
      (key === "token" || key === RESET_PASSWORD_TOKEN_COOKIE_NAME) &&
      typeof child === "string"
    ) {
      addToken(tokens, child);
    }
    collectNamedTokens(child, tokens, seen);
  }
}

function redactTokenValues(value: string, tokens: Set<string>): string {
  let redacted = isResetPasswordUrl(value) ? redactTokenFromUrl(value) : value;

  for (const token of tokens) {
    redacted = redacted.split(token).join(FILTERED_VALUE);
    redacted = redacted.split(encodeURIComponent(token)).join(FILTERED_VALUE);
  }

  return redacted;
}

function redactCookieHeader(value: string): string {
  return value
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(
      (cookie) => !cookie.startsWith(`${RESET_PASSWORD_TOKEN_COOKIE_NAME}=`),
    )
    .join("; ");
}

function redactAllEventFields(
  value: unknown,
  tokens: Set<string>,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") {
    return redactTokenValues(value, tokens);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const knownValue = seen.get(value);
  if (knownValue) {
    return knownValue;
  }

  if (Array.isArray(value)) {
    const redactedArray: unknown[] = [];
    seen.set(value, redactedArray);
    for (const item of value) {
      redactedArray.push(redactAllEventFields(item, tokens, seen));
    }
    return redactedArray;
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const redactedRecord: Record<string, unknown> = {};
  seen.set(value, redactedRecord);
  for (const [key, child] of Object.entries(value)) {
    if (key === "sdkProcessingMetadata") {
      redactedRecord[key] = child;
      continue;
    }
    if (key === RESET_PASSWORD_TOKEN_COOKIE_NAME) {
      continue;
    }
    if (key === "token" && typeof child === "string" && tokens.has(child)) {
      continue;
    }
    if (key.toLowerCase() === "cookie" && typeof child === "string") {
      redactedRecord[key] = redactTokenValues(
        redactCookieHeader(child),
        tokens,
      );
      continue;
    }
    redactedRecord[key] = redactAllEventFields(child, tokens, seen);
  }

  return redactedRecord;
}

export function redactResetPasswordToken<T extends SentryEventWithRequest>(
  event: T,
): T {
  const scan: ResetPasswordScan = {
    hasResetPasswordContext: false,
    tokens: new Set(),
  };
  scanResetPasswordContext(event, scan, new WeakSet());

  if (!scan.hasResetPasswordContext) {
    return event;
  }

  collectNamedTokens(event, scan.tokens, new WeakSet());
  const requestUrl = event.request?.url;
  const eventWithRedactedRequest =
    requestUrl && isResetPasswordUrl(requestUrl)
      ? {
          ...event,
          request: {
            ...event.request,
            url: redactTokenFromUrl(requestUrl),
            query_string: redactTokenFromQueryString(
              event.request?.query_string,
            ),
            headers: redactResetPasswordHeaders(event.request?.headers),
            cookies: redactResetPasswordCookies(event.request?.cookies),
          },
        }
      : event;

  return redactAllEventFields(
    eventWithRedactedRequest,
    scan.tokens,
    new WeakMap(),
  ) as T;
}
