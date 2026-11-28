import type { RegistryEntry } from "@sokosumi/masumi";
import { vi } from "vitest";
import {
  availableNetwork,
  fundedWalletStateFor,
  mainnetNetwork,
} from "@/services/__tests__/fixtures/agent-sync.x402-readiness.fixtures";

/** Both real Masumi SDK clients use fetch. No request leaves the test process. */
export function stubMasumiSyncHttp() {
  const networks = [mainnetNetwork(), availableNetwork()];
  const wallets = networks.map((network) =>
    fundedWalletStateFor(network, { id: network.id + "-wallet" }),
  );
  const state = {
    cardano: ["b", "a"].map((letter) => ({
      policyId: letter.repeat(56),
      smartContractAddress: "addr_" + letter,
      isPurchaseReady: true,
    })),
    networks,
    offline: false,
    registryEntries: [] as RegistryEntry[],
    registryRequests: [] as { cursorId?: string; statusUpdatedAfter: string }[],
  };
  const success = (data: unknown) => Response.json({ data });
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === "https://example.com") {
        if (
          url.pathname === "/registry/registry-diff/" &&
          request.method === "POST"
        ) {
          state.registryRequests.push(await request.json());
          return success({ entries: state.registryEntries });
        }
        if (request.method === "GET" && url.pathname.startsWith("/payment/")) {
          if (state.offline)
            return Response.json({ message: "offline" }, { status: 503 });
          switch (url.pathname) {
            case "/payment/rail-readiness":
              return success({
                Rails: [{ rail: "CardanoV2", PurchaseSources: state.cardano }],
              });
            case "/payment/api-key-status":
              return success({
                canPay: true,
                usageLimited: false,
                RemainingUsageCredits: [],
              });
            case "/payment/x402/networks/available":
              return success({ Networks: state.networks });
            case "/payment/x402/wallets":
              return success({ Wallets: wallets.map(({ wallet }) => wallet) });
            case "/payment/x402/wallets/balance": {
              const entry = wallets.find(
                ({ wallet }) => wallet.id === url.searchParams.get("id"),
              );
              if (entry)
                return success({
                  evmWalletId: entry.wallet.id,
                  address: entry.wallet.address,
                  Balances: entry.balances,
                });
            }
          }
        }
      }
      throw new Error(
        `Unexpected Masumi request ${request.method} ${url.pathname}`,
      );
    },
  );
  return state;
}
