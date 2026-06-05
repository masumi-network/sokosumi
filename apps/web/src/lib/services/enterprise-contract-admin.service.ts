import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  ActivateEnterpriseContractRequest,
  ActivateEnterpriseContractResponse,
  CreateEnterpriseContractRequest,
  EnterpriseContract,
  EnterpriseContractActivationBlocker,
  EnterpriseContractPreview,
  EnterpriseContractStatus,
  PatchEnterpriseContractRequest,
} from "@/lib/clients/generated/core/types.gen";

export interface EnterpriseContractActivationBlockedError {
  kind: "enterprise_activation_blocked";
  message: string;
  blocker: EnterpriseContractActivationBlocker;
}

export function parseEnterpriseContractActivationBlockedError(
  error: unknown,
): EnterpriseContractActivationBlockedError | null {
  if (!(error instanceof CoreApiRequestError) || error.status !== 409) {
    return null;
  }

  const details = error.details as
    | {
        kind?: string;
        message?: string;
        blocker?: EnterpriseContractActivationBlocker;
      }
    | undefined;

  if (details?.kind !== "enterprise_activation_blocked" || !details.blocker) {
    return null;
  }

  return {
    kind: "enterprise_activation_blocked",
    message:
      details.message ??
      "Enterprise contract activation blocked by an active organization subscription",
    blocker: details.blocker,
  };
}

export const enterpriseContractAdminService = (() => {
  async function listContracts(params?: {
    organizationSlug?: string;
    status?: EnterpriseContractStatus;
  }): Promise<EnterpriseContract[]> {
    const result = await coreClient.listEnterpriseContracts(params);
    return result.data;
  }

  async function getContract(id: string): Promise<EnterpriseContract> {
    const result = await coreClient.getEnterpriseContract(id);
    return result.data;
  }

  async function createContract(
    body: CreateEnterpriseContractRequest,
  ): Promise<EnterpriseContract> {
    const result = await coreClient.createEnterpriseContract(body);
    return result.data;
  }

  async function updateContract(
    id: string,
    body: PatchEnterpriseContractRequest,
  ): Promise<EnterpriseContract> {
    const result = await coreClient.patchEnterpriseContract(id, body);
    return result.data;
  }

  async function previewPeriods(
    id: string,
    activatedAt: Date,
  ): Promise<EnterpriseContractPreview> {
    const result = await coreClient.previewEnterpriseContractPeriods(
      id,
      activatedAt,
    );
    return result.data;
  }

  async function activateContract(
    id: string,
    body?: ActivateEnterpriseContractRequest,
  ): Promise<ActivateEnterpriseContractResponse> {
    const result = await coreClient.activateEnterpriseContract(id, body);
    return result.data;
  }

  async function cancelContract(id: string): Promise<EnterpriseContract> {
    const result = await coreClient.cancelEnterpriseContract(id);
    return result.data;
  }

  return {
    activateContract,
    cancelContract,
    createContract,
    getContract,
    listContracts,
    previewPeriods,
    updateContract,
  };
})();
