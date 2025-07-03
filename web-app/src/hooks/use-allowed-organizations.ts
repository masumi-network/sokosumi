import { useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { OrganizationWithRelations } from "@/lib/db/types/organization";
import { isValidEmail } from "@/lib/utils";

interface UseAllowedOrganizationsProps {
  email: string;
  prefilledOrganization?: OrganizationWithRelations | null;
}

export function useAllowedOrganizations({
  email,
  prefilledOrganization,
}: UseAllowedOrganizationsProps) {
  const [allowedOrganizations, setAllowedOrganizations] = useState<
    OrganizationWithRelations[]
  >(prefilledOrganization ? [prefilledOrganization] : []);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const debouncedFetchAllowedOrganizations = useDebouncedCallback(
    async (email: string, organizationId: string | null) => {
      setIsLoading(true);

      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const encodedEmail = encodeURIComponent(email);
        const encodedOrganizationId = organizationId
          ? encodeURIComponent(organizationId)
          : "";
        const result = await fetch(
          `/api/organization/allowed-to-join?email=${encodedEmail}&organizationId=${encodedOrganizationId}`,
          {
            signal: abortController.signal,
          },
        );
        if (!result.ok) {
          return [];
        }

        const data = await result.json();
        setAllowedOrganizations(data.allowedOrganizations);
        setIsLoading(false);
      } catch (error) {
        // Only handle errors that aren't from aborting
        if (error instanceof Error && error.name !== "AbortError") {
          setIsLoading(false);
          setAllowedOrganizations([]);
        }
      }
    },
    350,
    { trailing: true, leading: true },
  );

  useEffect(() => {
    debouncedFetchAllowedOrganizations.cancel();

    // Cancel any ongoing request when email changes
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!isValidEmail(email)) {
      setAllowedOrganizations([]);
      return;
    }

    debouncedFetchAllowedOrganizations(
      email,
      prefilledOrganization?.id ?? null,
    );
  }, [email, debouncedFetchAllowedOrganizations, prefilledOrganization]);

  return {
    allowedOrganizations,
    isLoading,
  };
}
