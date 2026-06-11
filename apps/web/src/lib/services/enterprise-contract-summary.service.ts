import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { EnterpriseContractBillingSummary } from "@/lib/clients/generated/core/types.gen";

export type { EnterpriseContractBillingSummary };

/**
 * Fetches the enterprise contract billing summary for an organization via the
 * core API. Returns null when the organization is not on an active enterprise
 * contract (core responds 404).
 */
export async function getEnterpriseContractBillingSummary(
  organizationId: string,
): Promise<EnterpriseContractBillingSummary | null> {
  try {
    const result =
      await coreClient.getOrganizationEnterpriseContractSummary(organizationId);

    return result.data;
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
