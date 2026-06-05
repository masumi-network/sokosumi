import {
  parseSelfServeSubscriptionPlanName,
  type SelfServeSubscriptionPlanName,
} from "@sokosumi/utils";
import {
  EnterpriseContractStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import { subscriptionRepository } from "../repositories/subscription.repository.js";
import {
  deriveEnterpriseContractEndDate,
  isEnterpriseContractConsumable,
} from "./enterprise-contract.js";
import { resolvePurchasedSeats } from "./organization-seats.js";
import { isActiveSubscriptionStatus } from "./subscription.js";

export type OrganizationBillingPlan =
  | {
      mode: "enterprise_contract";
      plan: "enterprise";
      isConsumable: boolean;
      purchasedSeats: number;
      contractId: string;
      endsAt: Date;
      activatedAt: Date;
      cancelAtPeriodEnd: false;
      periodEnd: null;
    }
  | {
      mode: "self_serve";
      plan: SelfServeSubscriptionPlanName;
      purchasedSeats: number;
      subscriptionId: string | null;
      cancelAtPeriodEnd: boolean;
      periodEnd: Date | null;
    };

export async function resolveOrganizationBillingPlan(
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<OrganizationBillingPlan> {
  const activeContract = await tx.enterpriseContract.findFirst({
    where: {
      organizationId,
      status: EnterpriseContractStatus.active,
      activatedAt: {
        not: null,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  if (activeContract?.activatedAt) {
    const isConsumable = isEnterpriseContractConsumable({
      activatedAt: activeContract.activatedAt,
      now,
      periodCount: activeContract.periodCount,
      status: activeContract.status,
    });

    return {
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable,
      purchasedSeats: activeContract.seats,
      contractId: activeContract.id,
      endsAt: deriveEnterpriseContractEndDate(
        activeContract.activatedAt,
        activeContract.periodCount,
      ),
      activatedAt: activeContract.activatedAt,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    };
  }

  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
    );

  const plan =
    subscription && isActiveSubscriptionStatus(subscription.status)
      ? (parseSelfServeSubscriptionPlanName(subscription.plan) ?? "free")
      : "free";

  const purchasedSeats =
    plan === "free" ? 0 : resolvePurchasedSeats(subscription?.seats);

  return {
    mode: "self_serve",
    plan,
    purchasedSeats,
    subscriptionId: subscription?.id ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    periodEnd: subscription?.periodEnd ?? null,
  };
}
