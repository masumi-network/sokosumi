"use client";

import { useMemo } from "react";

import { authClient } from "@/lib/auth/auth.client";

export interface UserOrganization {
  id: string;
  name: string;
  slug: string;
}

/**
 * Hook to fetch user's organizations for API key scope selection
 */
export function useUserOrganizations() {
  const {
    data: organizationsData,
    isPending,
    error,
  } = authClient.useListOrganizations();

  const organizations = useMemo(() => {
    if (!organizationsData) return [];

    return organizationsData.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
    }));
  }, [organizationsData]);

  return {
    organizations,
    isLoading: isPending,
    error: error?.message ?? null,
  };
}
