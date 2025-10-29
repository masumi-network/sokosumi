import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface UnAuthenticatedError extends Error {
  name: "UnAuthenticatedError";
  redirectUrl?: string;
}

export function useUnAuthenticatedErrorHandler(error: Error): {
  isUnAuthenticatedError: boolean;
  renderIfAuthenticated: (component: React.ReactNode) => React.ReactNode;
} {
  const router = useRouter();

  // Derive the authentication status directly from the error
  // Use error.name instead of instanceof due to serialization issues across server-client boundary
  const isUnAuthenticatedError = error.name === "UnAuthenticatedError";

  useEffect(() => {
    // Redirect to login if the error is UnAuthenticatedError
    if (isUnAuthenticatedError) {
      // Use the URL from the error if available, otherwise fall back to current URL
      const redirectUrl =
        (error as UnAuthenticatedError).redirectUrl ??
        window.location.pathname + window.location.search;
      const returnUrl = encodeURIComponent(redirectUrl);
      router.push(`/login?returnUrl=${returnUrl}`);
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
