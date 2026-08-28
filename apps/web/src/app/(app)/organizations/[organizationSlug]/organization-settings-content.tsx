import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { BillingPortalErrorToast } from "@/components/billing/billing-portal-error-toast";
import { MembersTable } from "@/components/members-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { coreClient } from "@/lib/clients/core.client";
import type {
  OrganizationDeletionEvaluation,
  OrganizationInviteLink,
  OrganizationRecord,
  PendingInvitation,
  StripeCustomerBillingDetails,
} from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";
import {
  organizationSeatService,
  organizationService,
  userService,
} from "@/lib/services";

import { OrganizationBillingAccessRestricted } from "./components/organization-billing-access-restricted";
import OrganizationBillingDetails from "./components/organization-billing-details";
import { OrganizationCoworkerAccess } from "./components/organization-coworker-access";
import OrganizationInformation from "./components/organization-information";
import OrganizationInviteButton from "./components/organization-invite-button";
import { OrganizationInviteLinks } from "./components/organization-invite-links";
import { OrganizationSeatSummaryCard } from "./components/organization-seat-summary";
import { OrganizationVendorGrants } from "./components/organization-vendor-grants";

interface OrganizationSettingsContentProps {
  organization: OrganizationRecord;
}

/**
 * Shared organization settings body for `/organization` (active workspace)
 * and `/organizations/[slug]` (deep link). Callers resolve membership and
 * pass the organization record — no redirect between those routes.
 */
export async function OrganizationSettingsContent({
  organization,
}: OrganizationSettingsContentProps) {
  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const tBilling = await getTranslations(
    "App.Organizations.OrganizationDetail.BillingDetails",
  );
  const tInviteLinks = await getTranslations(
    "App.Organizations.OrganizationDetail.InviteLinks",
  );
  const tDeletion = await getTranslations(
    "Components.Organizations.RemoveModal",
  );

  const member = await userService.getMyMemberInOrganization(organization.id);
  if (!member) {
    redirect("/");
  }

  const isOwnerOrAdmin =
    member.role === MemberRole.OWNER || member.role === MemberRole.ADMIN;
  let pendingInvitations: PendingInvitation[] = [];
  let inviteLinks: OrganizationInviteLink[] = [];
  let inviteLinksLoadError: ReactNode | undefined;

  if (isOwnerOrAdmin) {
    const [pendingResult, inviteLinksResult] = await Promise.all([
      organizationService.getPendingInvitations(organization.id).then(
        (data) => ({ ok: true as const, data }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      organizationService.getOrganizationInviteLinks(organization.id).then(
        (data) => ({ ok: true as const, data }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ]);

    if (pendingResult.ok) {
      pendingInvitations = pendingResult.data;
    } else {
      console.error("Failed to get pending invitations", pendingResult.error);
    }

    if (inviteLinksResult.ok) {
      inviteLinks = inviteLinksResult.data;
    } else {
      console.error(
        "Failed to get organization invite links",
        inviteLinksResult.error,
      );
      inviteLinksLoadError = (
        <CoreAuthReadRetry
          description={tInviteLinks("loadError")}
          retryLabel={tInviteLinks("retry")}
          title={tInviteLinks("loadErrorTitle")}
        />
      );
    }
  }

  let deletionBlockers: OrganizationDeletionEvaluation["blockers"] = [];
  let deletionPreflightFailed = false;
  let deletionPreflightLoadError: ReactNode | undefined;
  if (member.role === MemberRole.OWNER) {
    try {
      const deletionResponse = await coreClient.getOrganizationDeletion(
        organization.id,
      );
      deletionBlockers = deletionResponse.data.blockers;
    } catch (error) {
      console.error("Failed to load organization deletion blockers", error);
      deletionPreflightFailed = true;
      deletionPreflightLoadError = (
        <CoreAuthReadRetry
          description={tDeletion("preflightError")}
          retryLabel={tDeletion("retry")}
          title={tDeletion("loadErrorTitle")}
        />
      );
    }
  }

  const { data: members } = await coreClient.getOrganizationMembers(
    organization.id,
  );
  const seatSummary = isOwnerOrAdmin
    ? await organizationSeatService.getSeatSummary(organization.id)
    : null;

  let billingDetails: StripeCustomerBillingDetails | undefined;
  let billingDetailsLoadError: ReactNode | undefined;

  if (isOwnerOrAdmin) {
    try {
      const billingDetailsResponse =
        await coreClient.getOrganizationBillingDetails(organization.id);
      billingDetails = billingDetailsResponse.data;
    } catch (error) {
      console.error("Failed to load organization billing details", error);
      billingDetailsLoadError = (
        <CoreAuthReadRetry
          description={tBilling("loadError")}
          retryLabel={tBilling("retry")}
          title={tBilling("loadErrorTitle")}
        />
      );
    }
  }

  return (
    <div className="min-h-full w-full">
      <BillingPortalErrorToast
        generalMessage={tBilling("Errors.general")}
        unauthorizedMessage={tBilling("Errors.unauthorized")}
      />
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground">{t("roleIndicator")}</p>
          <OrganizationRoleBadge role={member.role} />
        </div>
        <OrganizationInformation
          organization={organization}
          member={member}
          deletionBlockers={deletionBlockers}
          deletionPreflightFailed={deletionPreflightFailed}
          deletionPreflightLoadError={deletionPreflightLoadError}
        />
        {isOwnerOrAdmin ? (
          <OrganizationBillingDetails
            billingDetails={billingDetails}
            billingDetailsLoadError={billingDetailsLoadError}
            organizationId={organization.id}
            organizationSlug={organization.slug}
          />
        ) : (
          <OrganizationBillingAccessRestricted />
        )}
        {isOwnerOrAdmin && seatSummary ? (
          <OrganizationSeatSummaryCard seatSummary={seatSummary} />
        ) : null}
        {isOwnerOrAdmin ? (
          <OrganizationVendorGrants organizationId={organization.id} />
        ) : null}
        {isOwnerOrAdmin ? (
          <OrganizationCoworkerAccess organizationId={organization.id} />
        ) : null}
        {isOwnerOrAdmin ? (
          <OrganizationInviteLinks
            organizationId={organization.id}
            inviteLinks={inviteLinks}
            inviteLinksLoadError={inviteLinksLoadError}
          />
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
