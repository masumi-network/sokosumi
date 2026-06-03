import {
  EnterpriseContractStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import { subscriptionRepository } from "../repositories/subscription.repository.js";
import {
  deriveEnterpriseContractEndDate,
  isEnterpriseContractActive,
} from "./enterprise-contract.js";
import { resolvePurchasedSeats } from "./organization-seats.js";
import { isActiveSubscriptionStatus } from "./subscription.js";

export type SelfServeSubscriptionPlanName =
  | "free"
  | "starter"
  | "standard"
  | "pro";

/** UI / entitlement label; `enterprise` is only set from an active enterprise contract. */
export type OrganizationBillingPlanName =
  | SelfServeSubscriptionPlanName
  | "enterprise";

export type OrganizationBillingPlan =
  | {
      mode: "enterprise_contract";
      plan: "enterprise";
      purchasedSeats: number;
      contractId: string;
      contractEnd: Date;
      startDate: Date;
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

export function parseSelfServeSubscriptionPlanName(
  value: string | null | undefined,
): SelfServeSubscriptionPlanName | null {
  if (!value) {
    return null;
  }

  switch (value.toLowerCase()) {
    case "free":
    case "starter":
    case "standard":
    case "pro":
      return value.toLowerCase() as SelfServeSubscriptionPlanName;
    default:
      return null;
  }
}

export async function resolveOrganizationBillingPlan(
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<OrganizationBillingPlan> {
  const activeContract = await tx.enterpriseContract.findFirst({
    where: {
      organizationId,
      status: EnterpriseContractStatus.active,
      startDate: {
        not: null,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  if (
    activeContract?.startDate &&
    isEnterpriseContractActive({
      now,
      periodCount: activeContract.periodCount,
      startDate: activeContract.startDate,
      status: activeContract.status,
    })
  ) {
    return {
      mode: "enterprise_contract",
      plan: "enterprise",
      purchasedSeats: activeContract.seats,
      contractId: activeContract.id,
      contractEnd: deriveEnterpriseContractEndDate(
        activeContract.startDate,
        activeContract.periodCount,
      ),
      startDate: activeContract.startDate,
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
