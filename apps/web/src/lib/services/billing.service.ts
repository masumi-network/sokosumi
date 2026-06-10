import "server-only";

import type { OrganizationBillingPlan } from "@sokosumi/database/helpers";
import { OrganizationSubscriptionExclusivityError } from "@sokosumi/database/helpers";
import type { OrganizationBillingPlanName } from "@sokosumi/utils";
import { convertCreditsToCents } from "@sokosumi/utils";

import { parsePlanName } from "@/components/billing/subscription-plan-utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const billingService = (() => {
  async function getCreditBalanceInCents(
    organizationId: string | null,
  ): Promise<bigint> {
    const response = organizationId
      ? await coreClient.getOrganizationCredits(organizationId)
      : await coreClient.getMyCredits();

    return convertCreditsToCents(response.data.credits.total);
  }

  async function getPersonalSubscription() {
    const response = await coreClient.getMyCredits();
    return response.data.subscription;
  }

  async function getOrganizationBillingPlan(
    organizationId: string,
  ): Promise<OrganizationBillingPlan> {
    const response =
      await coreClient.getOrganizationBillingPlan(organizationId);
    return response.data as OrganizationBillingPlan;
  }

  async function getCurrentPlanName(
    organizationId: string | null,
  ): Promise<OrganizationBillingPlanName> {
    if (organizationId) {
      const billingPlan = await getOrganizationBillingPlan(organizationId);
      return billingPlan.plan;
    }

    const subscription = await getPersonalSubscription();
    return parsePlanName(subscription?.plan) ?? "free";
  }

  async function assertPersonalSubscriptionChangeAllowed(): Promise<void> {
    try {
      await coreClient.getPersonalSubscriptionChangeAllowed();
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 422) {
        throw new OrganizationSubscriptionExclusivityError(error.message);
      }
      throw error;
    }
  }

  async function assertOrganizationSubscriptionChangeAllowed(
    organizationId: string,
  ): Promise<void> {
    try {
      await coreClient.getOrganizationSubscriptionChangeAllowed(organizationId);
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 422) {
        throw new OrganizationSubscriptionExclusivityError(error.message);
      }
      throw error;
    }
  }

  return {
    assertOrganizationSubscriptionChangeAllowed,
    assertPersonalSubscriptionChangeAllowed,
    getCreditBalanceInCents,
    getCurrentPlanName,
    getOrganizationBillingPlan,
    getPersonalSubscription,
  };
})();
