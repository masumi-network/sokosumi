"use client";

import { useTranslations } from "next-intl";

import { authClient } from "@/lib/auth/auth.client";

interface OrganizationNameDisplayProps {
  organizationId: string;
}

type OrganizationsList = NonNullable<
  ReturnType<typeof authClient.useListOrganizations>["data"]
>;
type OrganizationListItem = OrganizationsList[number];

export function OrganizationNameDisplay({
  organizationId,
}: OrganizationNameDisplayProps) {
  const t = useTranslations("App.Account.ApiKeys");
  const { data: organizations, isPending } = authClient.useListOrganizations();

  if (isPending) {
    return (
      <span className="text-muted-foreground">{t("Scope.organization")}</span>
    );
  }

  const organization = organizations?.find(
    (org: OrganizationListItem) => org.id === organizationId,
  );

  if (organization) {
    return (
      <span
        className="text-muted-foreground truncate"
        title={organization.name}
      >
        {organization.name}
      </span>
    );
  }

  return (
    <span className="text-muted-foreground">{t("Scope.organization")}</span>
  );
}
