import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface UnAuthorizedError extends Error {
  name: "UnAuthorizedError";
  redirectUrl?: string;
}

export function useUnauthorizedErrorHandler(error: Error): {
  isUnauthorizedError: boolean;
  renderIfAuthorized: (component: React.ReactNode) => React.ReactNode;
} {
  const router = useRouter();
  const [isUnauthorizedError, setIsUnauthorizedError] = useState(false);

  useEffect(() => {
    // Check if the error is UnAuthorizedError
    const isUnauthorized = error.name === "UnAuthorizedError";
    setIsUnauthorizedError(isUnauthorized);

    // Redirect to login if the error is UnAuthorizedError
    // Use error.name instead of instanceof due to serialization issues across server-client boundary
    if (isUnauthorized) {
      // Use the URL from the error if available, otherwise fall back to current URL
      const redirectUrl =
        (error as UnAuthorizedError).redirectUrl ??
        window.location.pathname + window.location.search;
      const returnUrl = encodeURIComponent(redirectUrl);
      router.push(`/login?returnUrl=${returnUrl}`);
    }
  }, [error, router]);

  const renderIfAuthorized = (component: React.ReactNode) => {
    return isUnauthorizedError ? null : component;
  };

  return {
    isUnauthorizedError,
    renderIfAuthorized,
  };
}
