import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { auth } from "@/lib/auth/auth";
import {
  type ActiveSubscription,
  resolveCurrentPlanName,
} from "@/lib/helpers/subscription";
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

function parseStatus(status: string | undefined): "cancel" | "success" | null {
  if (status === "success" || status === "cancel") {
    return status;
  }
  return null;
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
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <SubscriptionsPageContent
          currentPlan={currentPlan}
          plans={plans}
          status={parseStatus(status)}
        />
      </div>
    </div>
  );
}
