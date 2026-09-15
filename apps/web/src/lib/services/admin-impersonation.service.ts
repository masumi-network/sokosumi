import "server-only";

import { cookies } from "next/headers";

import { coreClient } from "@/lib/clients/core.client";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import type { AdminUserOption } from "@/lib/clients/generated/core";

/** The impersonated (start) or restored admin (stop) user: a Core DTO. */
export type ImpersonationUser = AdminUserOption;

export class ImpersonationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpersonationValidationError";
  }
}

interface ParsedSetCookie {
  name: string;
  value: string;
  options: {
    path?: string;
    domain?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
}

/**
 * Minimal Set-Cookie parser for forwarding Core session cookies to the
 * browser. Values are split on the first `=` only (base64 padding contains
 * `=`); unknown attributes are ignored.
 */
function parseSetCookie(header: string): ParsedSetCookie | null {
  const segments = header.split(";");
  const pair = segments[0]?.trim() ?? "";
  const separator = pair.indexOf("=");
  if (separator <= 0) {
    return null;
  }
  const name = pair.slice(0, separator).trim();
  if (!name) {
    return null;
  }
  const options: ParsedSetCookie["options"] = {};
  for (const segment of segments.slice(1)) {
    const [rawKey, ...rest] = segment.split("=");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const value = rest.join("=").trim();
    switch (key) {
      case "path":
        if (value) {
          options.path = value;
        }
        break;
      case "domain":
        if (value) {
          options.domain = value;
        }
        break;
      case "max-age": {
        const maxAge = Number(value);
        if (Number.isInteger(maxAge)) {
          options.maxAge = maxAge;
        }
        break;
      }
      case "expires": {
        const expires = new Date(value);
        if (!Number.isNaN(expires.getTime())) {
          options.expires = expires;
        }
        break;
      }
      case "httponly":
        options.httpOnly = true;
        break;
      case "secure":
        options.secure = true;
        break;
      case "samesite": {
        const sameSite = value.toLowerCase();
        if (
          sameSite === "lax" ||
          sameSite === "strict" ||
          sameSite === "none"
        ) {
          options.sameSite = sameSite;
        }
        break;
      }
    }
  }
  return { name, value: pair.slice(separator + 1).trim(), options };
}

/**
 * Applies Core's Set-Cookie session switch to the browser. Expiry cookies
 * (Max-Age=0) are forwarded as overwrites with the same attributes so the
 * browser drops the cookie.
 */
async function forwardSessionCookies(
  response: Response | undefined,
): Promise<void> {
  const setCookies =
    typeof response?.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  if (setCookies.length === 0) {
    throw new CoreApiRequestError("Impersonation did not return a session");
  }
  const store = await cookies();
  let forwarded = 0;
  for (const header of setCookies) {
    const parsed = parseSetCookie(header);
    if (parsed) {
      store.set(parsed.name, parsed.value, parsed.options);
      forwarded += 1;
    }
  }
  if (forwarded === 0) {
    throw new CoreApiRequestError(
      "Impersonation returned no usable session cookies",
    );
  }
}

export interface StartImpersonationParams {
  userId: string;
  reason: string;
}

export const adminImpersonationService = {
  async startImpersonation({
    userId,
    reason,
  }: StartImpersonationParams): Promise<ImpersonationUser> {
    if (!userId.trim()) {
      throw new ImpersonationValidationError("User id is required");
    }
    if (!reason.trim()) {
      throw new ImpersonationValidationError("Reason is required");
    }
    const { data, response } = await coreClient.startAdminImpersonation({
      userId,
      reason,
    });
    await forwardSessionCookies(response);
    return data.data;
  },

  async stopImpersonation(): Promise<ImpersonationUser> {
    const { data, response } = await coreClient.stopAdminImpersonation();
    await forwardSessionCookies(response);
    return data.data;
  },
};
