import type { Prisma } from "../generated/prisma/client.js";
import { memberRepository } from "../repositories/member.repository.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";

export const ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE =
  "This organization has an active enterprise contract. Self-serve subscriptions are not available.";

export const PERSONAL_SUBSCRIPTION_ENTERPRISE_EXCLUSIVITY_MESSAGE =
  "You belong to an organization with an active enterprise contract. Personal self-serve subscriptions are not available.";

export class OrganizationSubscriptionExclusivityError extends Error {
  override readonly name = "OrganizationSubscriptionExclusivityError";

  constructor(message: string) {
    super(message);
  }
}

export async function hasConsumableEnterpriseContract(
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<boolean> {
  const billingPlan = await resolveOrganizationBillingPlan(
    organizationId,
    tx,
    now,
  );

  return billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable;
}

export async function assertOrganizationSubscriptionChangeAllowed(
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<void> {
  if (await hasConsumableEnterpriseContract(organizationId, tx, now)) {
    throw new OrganizationSubscriptionExclusivityError(
      ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE,
    );
  }
}

export async function assertPersonalSubscriptionChangeAllowed(
  userId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<void> {
  const organizationIds =
    await memberRepository.getMembersOrganizationIdsByUserId(userId, tx);

  for (const organizationId of organizationIds) {
    if (await hasConsumableEnterpriseContract(organizationId, tx, now)) {
      throw new OrganizationSubscriptionExclusivityError(
        PERSONAL_SUBSCRIPTION_ENTERPRISE_EXCLUSIVITY_MESSAGE,
      );
    }
  }
}
