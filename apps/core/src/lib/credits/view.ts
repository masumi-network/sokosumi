import { streamTransactionCsv } from "@/helpers/transaction-history-csv";
import { createNetworkScope, type NetworkScope } from "@/lib/db/network-scope";
import { buildCreditsPayload } from "./funding";
import {
  type BuildTransactionHistoryParams,
  countTransactionHistory,
  findTransactionDailySpend,
  findTransactionHistoryPage,
  sumTransactionHistory,
} from "./history";

type HistoryFilter = Omit<BuildTransactionHistoryParams, "billingScope">;

/** Keep the existing Mainnet view even when the request middleware supplied a refused scope. */
export function creditViewForRequest(_requestScope: NetworkScope) {
  const billingScope = createNetworkScope("mainnet");
  return {
    billingScope,
    funding: (
      params: Omit<Parameters<typeof buildCreditsPayload>[0], "scope">,
    ) => buildCreditsPayload({ ...params, scope: billingScope }),
    page: (
      filter: HistoryFilter,
      pagination: { cursor?: string; take: number },
    ) => findTransactionHistoryPage({ ...filter, billingScope }, pagination),
    count: (filter: HistoryFilter) =>
      countTransactionHistory({ ...filter, billingScope }),
    total: (filter: HistoryFilter) =>
      sumTransactionHistory({ ...filter, billingScope }),
    daily: (filter: HistoryFilter) =>
      findTransactionDailySpend({ ...filter, billingScope }),
    csv: (filter: HistoryFilter) =>
      streamTransactionCsv({ ...filter, billingScope }),
  };
}
