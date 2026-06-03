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

export class EnterpriseContractNotFoundError extends EnterpriseContractLifecycleError {
  constructor(message = "Enterprise contract not found") {
    super(message);
    this.name = "EnterpriseContractNotFoundError";
  }
}
