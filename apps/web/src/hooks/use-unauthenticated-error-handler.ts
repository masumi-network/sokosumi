import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { UNAUTHENTICATED_ERROR_DIGEST } from "@/lib/auth/errors";

interface UnAuthenticatedError extends Error {
  name: "UnAuthenticatedError";
  redirectUrl?: string;
}

export function useUnAuthenticatedErrorHandler(
  error: Error & { digest?: string },
): {
  isUnAuthenticatedError: boolean;
  renderIfAuthenticated: (component: React.ReactNode) => React.ReactNode;
} {
  const router = useRouter();

  // Derive the authentication status directly from the error
  // Use error.name instead of instanceof due to serialization issues across server-client boundary
  //
  // The name only survives in development. A production build masks a server
  // error down to a generic `Error` plus its digest, so match the digest too -
  // that is the only part of `UnAuthenticatedError` that reaches a deployed
  // browser. `redirectUrl` does not survive either; the fallback below covers
  // it, and it already pointed at the current URL for every thrower in the app.
  const isUnAuthenticatedError =
    error.name === "UnAuthenticatedError" ||
    error.digest === UNAUTHENTICATED_ERROR_DIGEST;

  useEffect(() => {
    // Redirect to login if the error is UnAuthenticatedError
    if (isUnAuthenticatedError) {
      // Use the URL from the error if available, otherwise fall back to current URL
      const redirectUrl =
        (error as UnAuthenticatedError).redirectUrl ??
        window.location.pathname + window.location.search;
      const returnUrl = encodeURIComponent(redirectUrl);
      router.push(`/signin?returnUrl=${returnUrl}`);
    }
  }, [isUnAuthenticatedError, error, router]);

  const renderIfAuthenticated = (component: React.ReactNode) => {
    return isUnAuthenticatedError ? null : component;
  };

  return {
    isUnAuthenticatedError,
    renderIfAuthenticated,
  };
}
