import type { ErrorEvent } from "@sentry/nextjs";

import {
  RESET_PASSWORD_PATH,
  RESET_PASSWORD_TOKEN_COOKIE_NAME,
} from "@/lib/reset-password-token";

interface SentryEventWithRequest {
  request?: ErrorEvent["request"];
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

export function redactResetPasswordToken<T extends SentryEventWithRequest>(
  event: T,
): T {
  const requestUrl = event.request?.url;
  if (!requestUrl || !isResetPasswordUrl(requestUrl)) {
    return event;
  }

  return {
    ...event,
    request: {
      ...event.request,
      url: redactTokenFromUrl(requestUrl),
      query_string: redactTokenFromQueryString(event.request?.query_string),
      headers: redactResetPasswordHeaders(event.request?.headers),
      cookies: redactResetPasswordCookies(event.request?.cookies),
    },
  };
}
