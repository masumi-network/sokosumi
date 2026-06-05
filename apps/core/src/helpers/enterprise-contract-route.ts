import {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
  EnterpriseContractNotFoundError,
} from "@sokosumi/database/helpers";

import { mapEnterpriseContractActivationBlockerForApi } from "@/helpers/enterprise-contract-api.js";
import { conflict, notFound } from "@/helpers/error.js";

export function handleEnterpriseContractLifecycleError(error: unknown): never {
  if (error instanceof EnterpriseContractActivationError) {
    const blocker = mapEnterpriseContractActivationBlockerForApi(error.blocker);
    throw conflict(
      "Enterprise contract activation blocked by an active organization subscription",
      {
        kind: "enterprise_activation_blocked",
        extensions: { blocker, kind: "enterprise_activation_blocked" },
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
