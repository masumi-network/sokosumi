import {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
  EnterpriseContractNotFoundError,
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
        extensions: { blockers, kind: "enterprise_activation_blocked" },
      },
    );
  }

  if (error instanceof EnterpriseContractNotFoundError) {
    throw notFound(error.message);
  }

  if (error instanceof EnterpriseContractLifecycleError) {
    throw conflict(error.message);
  }

  throw error;
}
