interface SubscriptionRecord {
  id: string;
  plan: string;
  status: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
}

export function mapSubscription(subscription: SubscriptionRecord | null) {
  if (!subscription) {
    return null;
  }

  return {
    id: subscription.id,
    plan: subscription.plan,
    status: subscription.status,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}
