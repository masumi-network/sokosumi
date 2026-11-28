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
import { chargesCredits } from "./policy";

type HistoryFilter = Omit<BuildTransactionHistoryParams, "billingScope">;

/**
 * The request's Network: its scope when it works, else Mainnet's, the view a
 * refused scope kept before (a header for a Network the caller may not use).
 */
function viewedScope(requestScope: NetworkScope): NetworkScope {
  try {
    // A refusing scope throws on this read; it reads nothing.
    void requestScope.network;
  } catch {
    return createNetworkScope("mainnet");
  }
  return requestScope;
}

/**
 * The credit views of a request's Network. `network` and `charged` say what
 * every figure is: one Network's, and charged (Mainnet) or only recorded at
 * its price (Preprod). A total of one Network never includes the other's.
 */
export function creditViewForRequest(requestScope: NetworkScope) {
  const billingScope = viewedScope(requestScope);
  const { network } = billingScope;
  return {
    billingScope,
    network,
    charged: chargesCredits(network),
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
