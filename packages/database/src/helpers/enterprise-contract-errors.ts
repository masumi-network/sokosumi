import type { PaidSubscriptionBlocker } from "./enterprise-contract-exclusivity.js";

export class EnterpriseContractActivationError extends Error {
  readonly blockers: PaidSubscriptionBlocker[];

  constructor(blockers: PaidSubscriptionBlocker[]) {
    super("Enterprise contract activation blocked by paid subscriptions");
    this.name = "EnterpriseContractActivationError";
    this.blockers = blockers;
  }
}

export class EnterpriseContractLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnterpriseContractLifecycleError";
  }
}
