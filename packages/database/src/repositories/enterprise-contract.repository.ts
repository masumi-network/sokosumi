import type { Prisma } from "../generated/prisma/client.js";

export const enterpriseContractRepository = {
  async getContractWithPeriods(
    contractId: string,
    tx: Prisma.TransactionClient,
  ) {
    return tx.enterpriseContract.findUnique({
      where: { id: contractId },
      include: {
        periods: {
          orderBy: { periodStart: "asc" },
        },
      },
    });
  },
};
