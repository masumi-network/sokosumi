import { mapTransactionHistoryRow } from "@/helpers/transaction-history";
import { streamTransactionCsv } from "@/helpers/transaction-history-csv";
import type { NetworkScope } from "@/lib/db/network-scope";
import type { TransactionHistoryItem } from "@/schemas/transaction-history.schema";
import { buildCreditsPayload } from "./funding";
import {
  type BuildTransactionHistoryParams,
  countTransactionHistory,
  findTransactionDailySpend,
  findTransactionHistoryPage,
  sumTransactionHistory,
} from "./history";
import { chargesCredits } from "./policy";

type HistoryFilter = Omit<BuildTransactionHistoryParams, "billingScope">;

/**
 * The credit views of a request's Network. `network` and `affectsBalance` say what
 * every figure is: one Network's, and charged (Mainnet) or only recorded at
 * its price (Preprod). A total of one Network never includes the other's.
 */
export function creditViewForRequest(requestScope: NetworkScope) {
  const billingScope = requestScope;
  // A scope that refuses its Network answers here, with its own 403, before
  // any credit, plan or ledger read: a refused request sees no wallet.
  const { network } = billingScope;
  const affectsBalance = chargesCredits(network);
  return {
    billingScope,
    network,
    affectsBalance,
    item: (
      ...args: Parameters<typeof mapTransactionHistoryRow>
    ): TransactionHistoryItem => ({
      ...mapTransactionHistoryRow(...args),
      network,
      affectsBalance,
    }),
    funding: async (
      params: Omit<Parameters<typeof buildCreditsPayload>[0], "scope">,
    ) => ({
      ...(await buildCreditsPayload({ ...params, scope: billingScope })),
      network,
    }),
    page: (
      filter: HistoryFilter,
      pagination: { cursor?: string; take: number },
    ) => findTransactionHistoryPage({ ...filter, billingScope }, pagination),
    count: (filter: HistoryFilter) =>
      countTransactionHistory({ ...filter, billingScope }),
    total: async (filter: HistoryFilter) => ({
      ...(await sumTransactionHistory({ ...filter, billingScope })),
      network,
    }),
    daily: (filter: HistoryFilter) =>
      findTransactionDailySpend({ ...filter, billingScope }),
    csv: (filter: HistoryFilter) =>
      streamTransactionCsv({ ...filter, billingScope }),
  };
}
