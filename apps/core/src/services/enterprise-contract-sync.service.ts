import { runEnterpriseContractSchedulerPass } from "@sokosumi/database/helpers";

import prisma from "@/lib/db/prisma";

export interface EnterpriseContractRenewalSyncResult {
  catchUpGranted: number;
  completedContracts: number;
  expiredPeriods: number;
  preCreated: number;
}

export const enterpriseContractSyncService = {
  async runRenewalPass(): Promise<EnterpriseContractRenewalSyncResult> {
    return await prisma.$transaction(async (tx) => {
      return runEnterpriseContractSchedulerPass(tx);
    });
  },
};
