import "server-only";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { stripeClient } from "@better-auth/stripe/client";
import {
  betterAuthOrganizationAdditionalFields,
  betterAuthUserAdditionalFields,
} from "@sokosumi/utils";
import { APIError } from "better-auth/api";
import { createAuthClient } from "better-auth/client";
import {
  inferAdditionalFields,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { cookies } from "next/headers";

import { getServerCoreAuthBaseUrl } from "@/lib/clients/utils/core-api-base-url";

/**
 * Server-side facade over core's Better Auth instance.
 *
 * The Better Auth instance itself lives in `apps/core/src/lib/auth.ts`; web is
 * a pure HTTP consumer. This module preserves the `auth.api.*` call shapes the
 * app used when the instance ran in-process:
 *
 * - failures throw `APIError` with the same `{ body: { code, message } }`
 *   shape, so existing `betterAuthApiErrorSchema` error mapping is unchanged;
 * - auth-state-changing calls relay core's `Set-Cookie` headers onto the
 *   Next.js response (replacing the `nextCookies()` plugin, which only works
 *   with an in-process instance);
 * - date fields are revived from the JSON wire format (the in-process API
 *   returned `Date` instances).
 */

function createServerAuthClient() {
  return createAuthClient({
    baseURL: getServerCoreAuthBaseUrl(),
    plugins: [
      inferAdditionalFields({ user: betterAuthUserAdditionalFields }),
      organizationClient({
        schema: {
          organization: {
            additionalFields: betterAuthOrganizationAdditionalFields,
          },
        },
      }),
      magicLinkClient(),
      oauthProviderClient(),
      stripeClient({
        subscription: true,
      }),
    ],
  });
}

type ServerAuthClient = ReturnType<typeof createServerAuthClient>;

let cachedServerAuthClient: ServerAuthClient | null = null;

function getServerAuthClient(): ServerAuthClient {
  cachedServerAuthClient ??= createServerAuthClient();
  return cachedServerAuthClient;
}

export type Session = ServerAuthClient["$Infer"]["Session"];
export type SessionUser = ServerAuthClient["$Infer"]["Session"]["user"];
export type Invitation = ServerAuthClient["$Infer"]["Invitation"];
export type Account = NonNullable<
  Awaited<ReturnType<ServerAuthClient["listAccounts"]>>["data"]
>[number];

const FORWARDED_HEADER_NAMES = [
  "cookie",
  "accept-language",
  "user-agent",
  // Better Auth's CSRF origin check rejects cookie-bearing POSTs that lack an
  // origin/referer header, so both must survive the server-to-server hop.
  "origin",
  "referer",
  "x-forwarded-for",
  "x-vercel-forwarded-for",
] as const;

function buildForwardHeaders(requestHeaders?: Headers): Headers {
  const forwarded = new Headers();
  if (!requestHeaders) {
    return forwarded;
  }

  for (const name of FORWARDED_HEADER_NAMES) {
    const value = requestHeaders.get(name);
    if (value) {
      forwarded.set(name, value);
    }
  }

  return forwarded;
}

interface ServerAuthClientError {
  code?: string | undefined;
  message?: string | undefined;
  status: number;
  statusText: string;
}

const STATUS_NAME_BY_CODE: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

type ApiErrorStatus = ConstructorParameters<typeof APIError>[0];

function throwAsApiError(error: ServerAuthClientError): never {
  const status = (STATUS_NAME_BY_CODE[error.status] ??
    "INTERNAL_SERVER_ERROR") as ApiErrorStatus;

  throw new APIError(status, {
    code: error.code,
    message: error.message,
  });
}

function unwrap<T>(result: {
  data: T | null;
  error: ServerAuthClientError | null;
}): T {
  if (result.error) {
    throwAsApiError(result.error);
  }
  // better-fetch yields data XOR error; with no error the data is present.
  return result.data as T;
}

interface ParsedSetCookie {
  name: string;
  value: string;
  options: {
    domain?: string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: "lax" | "none" | "strict";
    secure?: boolean;
  };
}

function parseSetCookie(raw: string): ParsedSetCookie | null {
  const [nameValue, ...attributeParts] = raw.split(";");
  if (!nameValue) {
    return null;
  }

  const separatorIndex = nameValue.indexOf("=");
  if (separatorIndex < 0) {
    return null;
  }

  const name = nameValue.slice(0, separatorIndex).trim();
  const value = nameValue.slice(separatorIndex + 1).trim();
  if (!name) {
    return null;
  }

  const options: ParsedSetCookie["options"] = {};
  for (const part of attributeParts) {
    const [rawKey, rawValue] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    const attributeValue = rawValue?.trim();

    switch (key) {
      case "domain":
        if (attributeValue) options.domain = attributeValue;
        break;
      case "expires": {
        const parsed = attributeValue ? new Date(attributeValue) : null;
        if (parsed && !Number.isNaN(parsed.getTime())) {
          options.expires = parsed;
        }
        break;
      }
      case "httponly":
        options.httpOnly = true;
        break;
      case "max-age": {
        const parsed = attributeValue
          ? Number.parseInt(attributeValue, 10)
          : Number.NaN;
        if (Number.isFinite(parsed)) {
          options.maxAge = parsed;
        }
        break;
      }
      case "path":
        if (attributeValue) options.path = attributeValue;
        break;
      case "samesite": {
        const normalized = attributeValue?.toLowerCase();
        if (
          normalized === "lax" ||
          normalized === "none" ||
          normalized === "strict"
        ) {
          options.sameSite = normalized;
        }
        break;
      }
      case "secure":
        options.secure = true;
        break;
    }
  }

  return { name, value, options };
}

/**
 * Re-sets cookies issued by core onto the Next.js response. Next only allows
 * cookie writes in server actions and route handlers; in RSC render paths
 * `cookies().set` throws, and — exactly like the `nextCookies()` plugin this
 * replaces — the write is silently skipped there (e.g. a cookie-cache
 * refresh during render is lost, the session cookie itself stays valid).
 */
async function relaySetCookies(response: Response): Promise<void> {
  const setCookieHeaders = response.headers.getSetCookie();
  if (setCookieHeaders.length === 0) {
    return;
  }

  const cookieStore = await cookies();
  for (const raw of setCookieHeaders) {
    const parsed = parseSetCookie(raw);
    if (!parsed) {
      continue;
    }
    try {
      cookieStore.set(parsed.name, parsed.value, parsed.options);
    } catch {
      // Read-only context (RSC render) — skip, matching nextCookies().
    }
  }
}

function relayingFetchOptions(requestHeaders?: Headers) {
  return {
    headers: buildForwardHeaders(requestHeaders),
    onResponse: async (context: { response: Response }) => {
      await relaySetCookies(context.response);
    },
  };
}

const DATE_FIELD_NAMES = new Set([
  "accessTokenExpiresAt",
  "banExpires",
  "createdAt",
  "expiresAt",
  "periodEnd",
  "periodStart",
  "refreshTokenExpiresAt",
  "trialEnd",
  "trialStart",
  "updatedAt",
]);

const ISO_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Revives ISO date strings in known date fields. The in-process API returned
 * `Date` instances; over HTTP they arrive as strings while the types still
 * say `Date`.
 */
function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => reviveDates(entry)) as T;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      DATE_FIELD_NAMES.has(key) &&
      typeof entry === "string" &&
      ISO_DATE_TIME_REGEX.test(entry)
    ) {
      result[key] = new Date(entry);
    } else {
      result[key] = reviveDates(entry);
    }
  }
  return result as T;
}

interface HeadersOption {
  headers?: Headers;
}

export const auth = {
  api: {
    async getSession(options: {
      headers: Headers;
      query?: { disableCookieCache?: boolean };
    }): Promise<Session | null> {
      const result = await getServerAuthClient().getSession({
        fetchOptions: {
          headers: buildForwardHeaders(options.headers),
        },
        ...(options.query ? { query: options.query } : {}),
      });

      if (result.error) {
        if (result.error.status === 401) {
          return null;
        }
        throwAsApiError(result.error);
      }

      return result.data ? reviveDates(result.data as Session) : null;
    },

    async listUserAccounts(options: HeadersOption) {
      const result = await getServerAuthClient().listAccounts({
        fetchOptions: {
          headers: buildForwardHeaders(options.headers),
        },
      });
      return reviveDates(unwrap(result));
    },

    async updateUser(
      options: HeadersOption & {
        body: Record<string, unknown>;
      },
    ) {
      const result = await getServerAuthClient().updateUser(
        options.body,
        relayingFetchOptions(options.headers),
      );
      return unwrap(result);
    },

    async signUpEmail(
      options: HeadersOption & {
        body: Record<string, unknown>;
      },
    ) {
      const result = await getServerAuthClient().signUp.email(
        options.body as never,
        relayingFetchOptions(options.headers),
      );
      return reviveDates(unwrap(result));
    },

    async signInEmail(
      options: HeadersOption & {
        body: {
          callbackURL?: string;
          email: string;
          password: string;
          rememberMe?: boolean;
        };
      },
    ) {
      const result = await getServerAuthClient().signIn.email(
        options.body,
        relayingFetchOptions(options.headers),
      );
      return reviveDates(unwrap(result));
    },

    async signInMagicLink(
      options: HeadersOption & {
        body: {
          callbackURL?: string;
          email: string;
          name?: string;
        };
      },
    ) {
      const result = await getServerAuthClient().signIn.magicLink(
        options.body,
        relayingFetchOptions(options.headers),
      );
      return unwrap(result);
    },

    async getOAuthClientPublic(
      options: HeadersOption & {
        query: { client_id: string };
      },
    ): Promise<Record<string, unknown>> {
      const result = await getServerAuthClient().$fetch(
        "/oauth2/public-client",
        {
          headers: buildForwardHeaders(options.headers),
          query: options.query,
        },
      );
      return unwrap(
        result as {
          data: Record<string, unknown>;
          error: ServerAuthClientError | null;
        },
      );
    },

    async listActiveSubscriptions(
      options: HeadersOption & {
        query?: Record<string, string>;
      },
    ) {
      const result = await getServerAuthClient().subscription.list({
        fetchOptions: {
          headers: buildForwardHeaders(options.headers),
        },
        ...(options.query ? { query: options.query } : {}),
      });
      return reviveDates(unwrap(result));
    },

    async upgradeSubscription(
      options: HeadersOption & {
        body: Record<string, unknown>;
      },
    ) {
      type UpgradeArgs = Parameters<
        ServerAuthClient["subscription"]["upgrade"]
      >[0];
      const result = await getServerAuthClient().subscription.upgrade({
        ...(options.body as UpgradeArgs),
        fetchOptions: relayingFetchOptions(options.headers),
      });
      return unwrap(result);
    },

    async createBillingPortal(
      options: HeadersOption & {
        body: Record<string, unknown>;
      },
    ) {
      type BillingPortalArgs = Parameters<
        ServerAuthClient["subscription"]["billingPortal"]
      >[0];
      const result = await getServerAuthClient().subscription.billingPortal({
        ...(options.body as BillingPortalArgs),
        fetchOptions: relayingFetchOptions(options.headers),
      });
      return unwrap(result);
    },

    async createInvitation(
      options: HeadersOption & {
        body: {
          email: string;
          organizationId: string;
          resend?: boolean;
          /** Better Auth organization role (the MemberRole enum values). */
          role: string;
        };
      },
    ) {
      const result = await getServerAuthClient().organization.inviteMember({
        ...options.body,
        role: options.body.role as "admin" | "member" | "owner",
        fetchOptions: {
          headers: buildForwardHeaders(options.headers),
        },
      });
      return reviveDates(unwrap(result));
    },
  },
};
