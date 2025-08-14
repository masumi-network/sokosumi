"use client";

import { useTranslations } from "next-intl";

import { authClient } from "@/lib/auth/auth.client";

interface OrganizationSlugDisplayProps {
  organizationId: string;
}

/**
 * Component that displays the organization slug for a given organization ID
 * Uses the Better Auth hook to fetch organizations and find the matching one
 */
export function OrganizationSlugDisplay({
  organizationId,
}: OrganizationSlugDisplayProps) {
  const t = useTranslations("App.Account.ApiKeys");
  const { data: organizations, isPending } = authClient.useListOrganizations();

  if (isPending) {
    return (
      <span className="text-muted-foreground">{t("Scope.organization")}</span>
    );
  }

  // Find the organization with matching ID
  const organization = organizations?.find((org) => org.id === organizationId);

  if (organization) {
    return <span className="text-muted-foreground">{organization.slug}</span>;
  }

  // Fallback to generic "Organization" if not found
  return (
    <span className="text-muted-foreground">{t("Scope.organization")}</span>
  );
}
