import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CoreApiRequestError } from "@/lib/clients/core.client";

export function isUnauthorizedCoreApiError(error: unknown): boolean {
  if (!(error instanceof CoreApiRequestError)) {
    return false;
  }

  if (error.status === 401 || error.status === 403) {
    return true;
  }

  return /invalid, expired or missing session/i.test(error.message);
}

export async function redirectIfUnauthorizedCoreError(
  error: unknown,
): Promise<never> {
  if (isUnauthorizedCoreApiError(error)) {
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "";
    const searchParams = headersList.get("x-search-params") ?? "";
    const returnUrl = encodeURIComponent(pathname + searchParams);
    redirect(`/signin?returnUrl=${returnUrl}`);
  }

  throw error;
}

/**
 * Wraps the server-only Core client so any unauthorized API response redirects
 * to sign-in instead of surfacing as a masked RSC render error (SOKOSUMI-W).
 */
export function withUnauthorizedCoreRedirect<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value !== "function") {
        return value;
      }

      const method = value as (this: T, ...args: unknown[]) => unknown;

      function guardedMethod(this: unknown, ...args: unknown[]) {
        try {
          const result = method.apply(target, args) as unknown;

          if (
            result !== null &&
            typeof result === "object" &&
            "then" in result &&
            typeof (result as Promise<unknown>).then === "function"
          ) {
            return (result as Promise<unknown>).catch((error: unknown) =>
              redirectIfUnauthorizedCoreError(error),
            );
          }

          return result;
        } catch (error) {
          return redirectIfUnauthorizedCoreError(error);
        }
      }

      return guardedMethod;
    },
  }) as T;
}
