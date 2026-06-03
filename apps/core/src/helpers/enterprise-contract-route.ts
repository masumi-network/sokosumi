import {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
} from "@sokosumi/database/helpers";

import { mapEnterpriseContractActivationBlockerForApi } from "@/helpers/enterprise-contract-api.js";
import { conflict, notFound } from "@/helpers/error.js";

export function handleEnterpriseContractLifecycleError(error: unknown): never {
  if (error instanceof EnterpriseContractActivationError) {
    const blockers = error.blockers.map(
      mapEnterpriseContractActivationBlockerForApi,
    );
    const summary = blockers
      .map((blocker) => `${blocker.scope}:${blocker.subscriptionId}`)
      .join(", ");
    throw conflict(
      `Enterprise contract activation blocked by paid subscriptions: ${summary}`,
      {
        kind: "enterprise_activation_blocked",
        extensions: { blockers },
      },
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
