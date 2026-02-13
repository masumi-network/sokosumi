import { Invitation, MemberRole } from "@sokosumi/database";
import { organizationRepository } from "@sokosumi/database/repositories";
import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Stripe from "stripe";

import {
  type ActiveSubscription,
  parsePlanName,
  resolveLatestSubscription,
  type SubscriptionPlanView,
} from "@/components/billing/subscription-plan-utils";
import { MembersTable } from "@/components/members-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { getEnvSecrets } from "@/config/env.secrets";
import { auth } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma";
import { organizationService, userService } from "@/lib/services";
import {
  getSubscriptionCatalog,
  type SubscriptionPlanName,
} from "@/lib/stripe/subscription-catalog";

import OrganizationInformation from "./components/organization-information";
import OrganizationInviteButton from "./components/organization-invite-button";
import OrganizationInvoiceEmail from "./components/organization-invoice-email";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const PLAN_ORDER: SubscriptionPlanName[] = [
  "free",
  "starter",
  "standard",
  "pro",
];

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
    await organizationRepository.getOrganizationWithRelationsBySlug(
      normalizedSlug,
      prisma,
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
    await organizationRepository.getOrganizationWithRelationsBySlug(
      normalizedSlug,
      prisma,
    );
  if (!organization) {
    return notFound();
  }

  const member = await userService.getMyMemberInOrganization(organization.id);
  if (!member) {
    redirect("/organizations");
  }

  const isOwnerOrAdmin =
    member.role === MemberRole.OWNER || member.role === MemberRole.ADMIN;
  let pendingInvitations: Invitation[] = [];
  let organizationSubscriptionProps: {
    currentPlan: SubscriptionPlanName | null;
    currentSeats: number;
    memberCount: number;
    organizationId: string;
    plans: SubscriptionPlanView[];
    returnPath: string;
  } | null = null;

  if (isOwnerOrAdmin) {
    try {
      pendingInvitations = await organizationService.getPendingInvitations(
        organization.id,
      );
    } catch (error) {
      console.error("Failed to get pending invitations", error);
    }

    try {
      const requestHeaders = await headers();
      const [subscriptionCatalog, activeSubscriptions] = await Promise.all([
        getSubscriptionCatalog(stripeInstance),
        auth.api.listActiveSubscriptions({
          headers: requestHeaders,
          query: {
            customerType: "organization",
            referenceId: organization.id,
          },
        }),
      ]);

      const latestSubscription = resolveLatestSubscription(
        activeSubscriptions as ActiveSubscription[],
      );
      const currentPlan = parsePlanName(latestSubscription?.plan) ?? "free";
      const currentSeats = Math.max(
        latestSubscription?.seats ?? 1,
        organization._count.members,
      );

      organizationSubscriptionProps = {
        currentPlan,
        currentSeats,
        memberCount: organization._count.members,
        organizationId: organization.id,
        plans: PLAN_ORDER.map((planName) => {
          const plan = subscriptionCatalog[planName];
          return {
            credits: plan.credits,
            currency: plan.currency,
            isCurrent: currentPlan === planName,
            monthlyAmount: plan.monthlyAmount,
            name: planName,
          };
        }),
        returnPath: `/organizations/${encodeURIComponent(organization.slug)}`,
      };
    } catch (error) {
      console.error("Failed to get organization subscription data", error);
    }
  }

  const members = await organizationService.getOrganizationMembersWithUser(
    organization.id,
  );

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground">{t("roleIndicator")}</p>
          <OrganizationRoleBadge role={member.role} />
        </div>
        <OrganizationInformation organization={organization} member={member} />
        <OrganizationInvoiceEmail organization={organization} member={member} />
        {isOwnerOrAdmin ? (
          <div className="flex items-center justify-between">
            <div />
            <div className="flex items-center gap-1.5">
              <OrganizationInviteButton
                organizationId={organization.id}
                className="h-7 px-2.5 text-xs"
              />
            </div>
          </div>
        ) : null}
        <MembersTable
          me={member}
          members={members}
          pendingInvitations={pendingInvitations}
        />
      </div>
    </div>
  );
}
