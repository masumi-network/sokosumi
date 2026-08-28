import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

import { OrganizationSettingsContent } from "./organization-settings-content";

interface OrganizationPageProps {
  params: Promise<{ organizationSlug: string }>;
}

/**
 * Resolves the organization record for `slug` via the member-gated Core
 * endpoint. Returns null when no organization matches the slug; redirects to
 * the home page when the caller has no (valid) membership — mirroring the
 * previous in-page membership check.
 */
async function getMemberOrganizationBySlug(slug: string) {
  try {
    const response = await coreClient.getOrganizationBySlug(slug);
    return response?.data ?? null;
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect("/");
    }
    throw error;
  }
}

export async function generateMetadata({
  params,
}: OrganizationPageProps): Promise<Metadata> {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.Metadata",
  );

  const { organizationSlug } = await params;
  const normalizedSlug = decodeURIComponent(organizationSlug);

  const organization = await getMemberOrganizationBySlug(normalizedSlug);
  if (!organization) {
    return notFound();
  }

  return {
    title: {
      default: t("Title.default", { name: organization.name }),
      template: t("Title.template", { name: organization.name }),
    },
    description: t("description"),
  };
}

export default async function OrganizationPage({
  params,
}: OrganizationPageProps) {
  const { organizationSlug } = await params;
  const normalizedSlug = decodeURIComponent(organizationSlug);

  const organization = await getMemberOrganizationBySlug(normalizedSlug);
  if (!organization) {
    return notFound();
  }

  return <OrganizationSettingsContent organization={organization} />;
}
