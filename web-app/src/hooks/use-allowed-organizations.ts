import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { OrganizationWithRelations } from "@/lib/db/types/organization";
import { isValidEmail } from "@/lib/utils";

interface UseAllowedOrganizationsProps {
  email: string;
  prefilledOrganization?: OrganizationWithRelations | null;
}

interface AllowedOrganizationsResponse {
  allowedOrganizations: OrganizationWithRelations[];
}

export function useAllowedOrganizations({
  email,
  prefilledOrganization,
}: UseAllowedOrganizationsProps) {
  const [allowedOrganizations, setAllowedOrganizations] = useState<
    OrganizationWithRelations[]
  >(prefilledOrganization ? [prefilledOrganization] : []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const resetState = useCallback(() => {
    setIsLoading(false);
    setError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const debouncedFetchAllowedOrganizations = useDebouncedCallback(
    async (email: string) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);
      setError(null);

      try {
        const encodedEmail = encodeURIComponent(email);
        const result = await fetch(
          `/api/organization/allowed-by-email-domain?email=${encodedEmail}`,
          {
            signal: abortController.signal,
          },
        );
        if (!result.ok) {
          setAllowedOrganizations([]);
          return;
        }

        const data: AllowedOrganizationsResponse = await result.json();
        setAllowedOrganizations(data.allowedOrganizations);
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          console.error("Error fetching allowed organizations", error);
          setError(error instanceof Error ? error : new Error("Unknown error"));
        }
        setAllowedOrganizations([]);
      } finally {
        setIsLoading(false);
      }
    },
    350,
    { trailing: true, leading: true },
  );

  useEffect(() => {
    debouncedFetchAllowedOrganizations.cancel();
    resetState();

    if (prefilledOrganization) {
      setAllowedOrganizations([prefilledOrganization]);
      return;
    }

    if (!isValidEmail(email)) {
      setAllowedOrganizations([]);
      return;
    }

    debouncedFetchAllowedOrganizations(email);
  }, [
    email,
    prefilledOrganization,
    debouncedFetchAllowedOrganizations,
    resetState,
  ]);

  return {
    allowedOrganizations,
    isLoading,
    error,
  };
}
