import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { userService } from "@/lib/services";

import { OrganizationSettingsContent } from "../organizations/[organizationSlug]/organization-settings-content";

/**
 * Context path for the active organization's settings (Settings → Organization).
 * Renders in place — no hop to `/organizations/{slug}`. Deep links and invites
 * still use the slug route, which shares the same content module.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.Metadata",
  );

  const [activeOrganizationId, memberships] = await Promise.all([
    userService.getActiveOrganizationId(),
    userService.getMyMembersWithOrganizations(),
  ]);

  const membership = activeOrganizationId
    ? memberships.find((m) => m.organizationId === activeOrganizationId)
    : undefined;

  if (!membership) {
    return { description: t("description") };
  }

  return {
    title: {
      default: t("Title.default", { name: membership.organization.name }),
      template: t("Title.template", {
        name: membership.organization.name,
      }),
    },
    description: t("description"),
  };
}

export default async function OrganizationPage() {
  const [activeOrganizationId, memberships] = await Promise.all([
    userService.getActiveOrganizationId(),
    userService.getMyMembersWithOrganizations(),
  ]);

  const membership = activeOrganizationId
    ? memberships.find((m) => m.organizationId === activeOrganizationId)
    : undefined;

  if (!membership) {
    redirect("/");
  }

  return <OrganizationSettingsContent organization={membership.organization} />;
}
