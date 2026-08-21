import type {
  X402AvailableNetwork,
  X402Budget,
  X402Wallet,
} from "@sokosumi/masumi";

export const USDC_BASE_SEPOLIA =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e".toLowerCase();

export function availableNetwork(
  overrides: Partial<X402AvailableNetwork> = {},
): X402AvailableNetwork {
  return {
    id: "x402net_1",
    caip2Id: "eip155:84532",
    displayName: "Base Sepolia",
    isTestnet: true,
    isEnabled: true,
    canSettle: false,
    defaultAsset: USDC_BASE_SEPOLIA,
    defaultAssetDecimals: 6,
    ...overrides,
  };
}

export function budget(overrides: Partial<X402Budget> = {}): X402Budget {
  return {
    id: "x402budget_1",
    apiKeyId: "apikey_1",
    evmWalletId: "wallet_1",
    evmWalletAddress: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
    caip2Network: "eip155:84532",
    asset: USDC_BASE_SEPOLIA,
    remainingAmount: "1000000",
    spentAmount: "0",
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function purchasingWallet(
  overrides: Partial<X402Wallet> = {},
): X402Wallet {
  return {
    id: "wallet_admin",
    networkId: "x402net_1",
    caip2Network: "eip155:84532",
    address: "0x24F8AA31184EE239b47bfac3565bCFfEd1Ff50f6",
    type: "Purchasing",
    note: null,
    createdById: "apikey_admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function fundedWalletBalances(
  overrides: Partial<{
    native: { symbol: string; decimals: number; amount: string } | null;
    asset: {
      asset: string;
      symbol: string | null;
      decimals: number;
      amount: string;
    } | null;
    error: string | null;
  }> = {},
) {
  return [
    {
      caip2Network: "eip155:84532",
      displayName: "Base Sepolia",
      native: { symbol: "ETH", decimals: 18, amount: "1" },
      asset: {
        asset: USDC_BASE_SEPOLIA,
        symbol: "USDC",
        decimals: 6,
        amount: "1000000",
      },
      error: null,
      ...overrides,
    },
  ];
}

export const READY_SOURCE = {
  caip2Network: "eip155:84532",
  asset: USDC_BASE_SEPOLIA,
  evmWalletId: "wallet_1",
  evmWalletAddress: budget().evmWalletAddress.toLowerCase(),
  decimals: 6,
};

export const ADMIN_WALLET_ADDRESS = purchasingWallet().address.toLowerCase();

export const BASE_MAINNET_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export function mainnetNetwork(
  overrides: Partial<X402AvailableNetwork> = {},
): X402AvailableNetwork {
  return availableNetwork({
    id: "x402net_2",
    caip2Id: "eip155:8453",
    isTestnet: false,
    defaultAsset: BASE_MAINNET_USDC,
    ...overrides,
  });
}

export function mainnetBudget(overrides: Partial<X402Budget> = {}): X402Budget {
  return budget({
    id: "x402budget_mainnet",
    evmWalletId: "wallet_mainnet",
    caip2Network: "eip155:8453",
    asset: BASE_MAINNET_USDC,
    ...overrides,
  });
}

export function walletStateForBudget(
  budgetRow: X402Budget,
  networks: readonly X402AvailableNetwork[],
) {
  const network = networks.find(
    (candidate) =>
      candidate.caip2Id.toLowerCase() === budgetRow.caip2Network.toLowerCase(),
  );
  return {
    wallet: purchasingWallet({
      id: budgetRow.evmWalletId,
      networkId: network?.id ?? "x402net_unknown",
      caip2Network: budgetRow.caip2Network,
      address: budgetRow.evmWalletAddress,
    }),
    balances: [
      {
        caip2Network: budgetRow.caip2Network,
        displayName: network?.displayName ?? "Unknown",
        native: { symbol: "ETH", decimals: 18, amount: "1" },
        asset: {
          asset: budgetRow.asset,
          symbol: "USDC",
          decimals: network?.defaultAssetDecimals ?? 6,
          amount: "1000000",
        },
        error: null,
      },
    ],
  };
}
