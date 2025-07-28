import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MembersTable } from "@/components/members-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import { retrieveOrganizationWithRelationsBySlug } from "@/lib/db/repositories";
import {
  getMyMemberInOrganization,
  getOrganizationMembersWithUser,
  getOrganizationPendingInvitations,
} from "@/lib/services";
import { Invitation } from "@/prisma/generated/client";

import OrganizationInformation from "./components/organization-information";
import OrganizationInviteButton from "./components/organization-invite-button";

interface OrganizationPageProps {
  params: Promise<{ organizationSlug: string }>;
}

export async function generateMetadata({
  params,
}: OrganizationPageProps): Promise<Metadata> {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.Metadata",
  );

  const { organizationSlug } = await params;
  const organization =
    await retrieveOrganizationWithRelationsBySlug(organizationSlug);
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
  await getSessionOrRedirect();

  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const { organizationSlug } = await params;

  const organization =
    await retrieveOrganizationWithRelationsBySlug(organizationSlug);
  if (!organization) {
    return notFound();
  }

  const member = await getMyMemberInOrganization(organization.id);
  if (!member) {
    redirect("/organizations");
  }

  const members = await getOrganizationMembersWithUser(organization.id, true);

  let pendingInvitations: Invitation[] = [];
  if (member.role === MemberRole.ADMIN) {
    try {
      pendingInvitations = await getOrganizationPendingInvitations(
        organization.id,
      );
    } catch (error) {
      console.error("Failed to get pending invitations", error);
    }
  }

  return (
    <div className="container flex flex-col gap-8 p-8">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground">{t("roleIndicator")}</p>
        <OrganizationRoleBadge role={member.role} />
      </div>
      <OrganizationInformation organization={organization} member={member} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light">{t("members")}</h1>
        {member.role === MemberRole.ADMIN && (
          <OrganizationInviteButton organizationId={organization.id} />
        )}
      </div>
      <MembersTable
        me={member}
        members={members}
        pendingInvitations={pendingInvitations}
      />
    </div>
  );
}
