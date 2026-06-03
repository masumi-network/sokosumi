import {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
} from "@sokosumi/database/helpers";

import { conflict, notFound } from "@/helpers/error.js";

export function handleEnterpriseContractLifecycleError(error: unknown): never {
  if (error instanceof EnterpriseContractActivationError) {
    const summary = error.blockers
      .map((blocker) => `${blocker.scope}:${blocker.subscriptionId}`)
      .join(", ");
    throw conflict(
      `Enterprise contract activation blocked by paid subscriptions: ${summary}`,
    );
  }

  if (error instanceof EnterpriseContractLifecycleError) {
    if (error.message.toLowerCase().includes("not found")) {
      throw notFound(error.message);
    }
    throw conflict(error.message);
  }

  throw error;
}
