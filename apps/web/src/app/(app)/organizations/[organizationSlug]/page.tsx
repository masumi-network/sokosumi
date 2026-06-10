import { type Invitation, MemberRole } from "@sokosumi/database";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MembersTable } from "@/components/members-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { coreClient } from "@/lib/clients/core.client";
import {
  organizationSeatService,
  organizationService,
  userService,
} from "@/lib/services";

import OrganizationInformation from "./components/organization-information";
import OrganizationInviteButton from "./components/organization-invite-button";
import OrganizationInvoiceEmail from "./components/organization-invoice-email";
import { OrganizationSeatSummaryCard } from "./components/organization-seat-summary";

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
  const normalizedSlug = decodeURIComponent(organizationSlug);

  const organization =
    await organizationService.getOrganizationWithRelationsBySlug(
      normalizedSlug,
    );
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
  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const { organizationSlug } = await params;
  const normalizedSlug = decodeURIComponent(organizationSlug);

  const organization =
    await organizationService.getOrganizationWithRelationsBySlug(
      normalizedSlug,
    );
  if (!organization) {
    return notFound();
  }

  const member = await userService.getMyMemberInOrganization(organization.id);
  if (!member) {
    redirect("/");
  }

  const isOwnerOrAdmin =
    member.role === MemberRole.OWNER || member.role === MemberRole.ADMIN;
  let pendingInvitations: Invitation[] = [];

  if (isOwnerOrAdmin) {
    try {
      pendingInvitations = await organizationService.getPendingInvitations(
        organization.id,
      );
    } catch (error) {
      console.error("Failed to get pending invitations", error);
    }
  }

  const { data: members } = await coreClient.getOrganizationMembers(
    organization.id,
  );
  const seatSummary = isOwnerOrAdmin
    ? await organizationSeatService.getSeatSummary(organization.id)
    : null;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground">{t("roleIndicator")}</p>
          <OrganizationRoleBadge role={member.role} />
        </div>
        <OrganizationInformation organization={organization} member={member} />
        <OrganizationInvoiceEmail organization={organization} member={member} />
        {isOwnerOrAdmin && seatSummary ? (
          <OrganizationSeatSummaryCard seatSummary={seatSummary} />
        ) : null}
        <div className="space-y-4">
          {isOwnerOrAdmin ? (
            <div className="flex items-center justify-end gap-1.5">
              <OrganizationInviteButton
                organizationId={organization.id}
                className="h-7 px-2.5 text-xs"
              />
            </div>
          ) : null}
          <MembersTable
            me={member}
            members={members}
            pendingInvitations={pendingInvitations}
            showSeatManagement={isOwnerOrAdmin && seatSummary?.paidPlan != null}
            unusedSeats={seatSummary?.unusedSeats ?? 0}
          />
        </div>
        <div aria-hidden className="h-12 shrink-0" />
      </div>
    </div>
  );
}
