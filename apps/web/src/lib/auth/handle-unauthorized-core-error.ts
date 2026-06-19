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

export function redirectUnauthorizedPromise<T>(
  promise: Promise<T>,
): Promise<T> {
  return promise.catch((error) => redirectIfUnauthorizedCoreError(error));
}
