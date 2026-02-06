import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { auth } from "@/lib/auth/auth";
import {
  getSubscriptionCatalog,
  type SubscriptionPlanName,
} from "@/lib/stripe/subscription-catalog";

import SubscriptionsPageContent, {
  type SubscriptionPlanView,
} from "./components/subscriptions-page-content";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const PLAN_ORDER: SubscriptionPlanName[] = [
  "free",
  "starter",
  "standard",
  "pro",
];

interface SubscriptionsPageProps {
  searchParams: Promise<{
    status?: string;
  }>;
}

interface ActiveSubscription {
  plan?: string | null;
  periodEnd?: Date | string | null;
}

function parseStatus(status: string | undefined): "cancel" | "success" | null {
  if (status === "success" || status === "cancel") {
    return status;
  }
  return null;
}

function parsePlanName(
  value: string | null | undefined,
): SubscriptionPlanName | null {
  if (!value) {
    return null;
  }

  switch (value.toLowerCase()) {
    case "free":
    case "starter":
    case "standard":
    case "pro":
      return value.toLowerCase() as SubscriptionPlanName;
    default:
      return null;
  }
}

function getDateValue(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return Number.isNaN(Date.parse(value)) ? 0 : Date.parse(value);
}

function resolveCurrentPlanName(
  subscriptions: ActiveSubscription[],
): SubscriptionPlanName | null {
  if (subscriptions.length === 0) {
    return null;
  }

  const sortedSubscriptions = [...subscriptions].sort((a, b) => {
    return getDateValue(b.periodEnd) - getDateValue(a.periodEnd);
  });

  return parsePlanName(sortedSubscriptions[0]?.plan);
}

export default async function SubscriptionsPage({
  searchParams,
}: SubscriptionsPageProps) {
  const requestHeaders = await headers();
  const { status } = await searchParams;

  const [subscriptionCatalog, activeSubscriptions] = await Promise.all([
    getSubscriptionCatalog(stripeInstance),
    auth.api.listActiveSubscriptions({
      headers: requestHeaders,
      query: {
        customerType: "user",
      },
    }),
  ]);

  const currentPlan =
    resolveCurrentPlanName(activeSubscriptions as ActiveSubscription[]) ??
    "free";
  const plans: SubscriptionPlanView[] = PLAN_ORDER.map((planName) => {
    const plan = subscriptionCatalog[planName];
    return {
      credits: plan.credits,
      currency: plan.currency,
      isCurrent: currentPlan === planName,
      monthlyAmount: plan.monthlyAmount,
      name: planName,
    };
  });

  return (
    <SubscriptionsPageContent
      currentPlan={currentPlan}
      plans={plans}
      status={parseStatus(status)}
    />
  );
}
