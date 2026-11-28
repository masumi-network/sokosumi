import type { RegistryEntry } from "@sokosumi/masumi";
import { vi } from "vitest";
import {
  availableNetwork,
  fundedWalletStateFor,
  mainnetNetwork,
} from "@/services/__tests__/fixtures/agent-sync.x402-readiness.fixtures";

/** Both real Masumi SDK clients use fetch. No request leaves the test process. */
export function stubMasumiSyncHttp(beforeRegistryReply?: () => Promise<void>) {
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
          await beforeRegistryReply?.();
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

/** One registry revision with distinguishable prices on the two deployment rails. */
export function registrySyncRevision(version: number): RegistryEntry {
  const policyId = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";
  const date = new Date(Date.UTC(2026, 10, 1, 0, 0, version));
  return {
    id: `registry-${version}`,
    name: "Registry fixture",
    description: "Canonical",
    agentIdentifier:
      policyId + "ab".repeat(29) + version.toString(16).padStart(6, "0"),
    createdAt: date,
    updatedAt: date,
    lastUptimeCheck: date,
    statusUpdatedAt: date,
    uptimeCount: 7,
    uptimeCheckCount: 9,
    status: "Online",
    type: "Standard",
    apiBaseUrl: "https://seller.example",
    openApiSpecUrl: null,
    x402ResourcesUrl: null,
    supersedesAgentIdentifier: null,
    supersededByAgentIdentifier: null,
    authorName: null,
    authorOrganization: null,
    authorContactEmail: null,
    authorContactOther: null,
    image: null,
    privacyPolicy: null,
    termsAndCondition: null,
    otherLegal: null,
    tags: ["z-sync", "a-sync"],
    metadataVersion: version,
    Verifications: [],
    Capability: null,
    paymentType: "Web3CardanoV2",
    RegistrySource: { id: "fixture", policyId, url: null },
    AgentPricing: null,
    SupportedPaymentSources: ["Mainnet", "Preprod"].map((network, index) => ({
      sourceIndex: 1 - index,
      chain: "Cardano",
      network,
      address: "addr_b",
      payTo: "seller",
      paymentSourceType: "Web3CardanoV2",
      scheme: null,
      resource: null,
      pricing: {
        pricingType: "Fixed",
        fixed: [
          {
            asset: "lovelace",
            amount: String(10 * version + index),
            decimals: 6,
          },
          { asset: "abc", amount: String(version + index + 1), decimals: 2 },
        ],
      },
    })),
    ExampleOutput: ["z", "a"].map((name) => ({
      name: name + version,
      mimeType: "text/plain",
      url: "https://seller.example/" + name,
    })),
  };
}
