import type {
  X402AvailableNetwork,
  X402KeySpendCaps,
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

/**
 * The calling key's spend cap. Defaults to an UNCAPPED key, because that is
 * the shape most readiness cases are about: the cap is one gate among four,
 * and only the cap-specific tests should have to state it.
 */
export function keySpendCaps(
  overrides: Partial<X402KeySpendCaps> = {},
): X402KeySpendCaps {
  return {
    usageLimited: false,
    creditsByUnit: new Map<string, bigint>(),
    grandfatheredUncapped: false,
    ...overrides,
  };
}

/** A usage-limited key holding `amount` for the default Base Sepolia pair. */
export function cappedWith(amount: bigint): X402KeySpendCaps {
  return keySpendCaps({
    usageLimited: true,
    creditsByUnit: new Map([[`eip155:84532:${USDC_BASE_SEPOLIA}`, amount]]),
  });
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

export const PURCHASING_WALLET_ADDRESS =
  purchasingWallet().address.toLowerCase();

export const READY_SOURCE = {
  caip2Network: "eip155:84532",
  asset: USDC_BASE_SEPOLIA,
  evmWalletId: purchasingWallet().id,
  evmWalletAddress: PURCHASING_WALLET_ADDRESS,
  decimals: 6,
};

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

/**
 * A funded Purchasing wallet on `network`, ready to back that chain's pair.
 * Balances mirror the node's published scale so the compose's scale check
 * passes; a test that wants it to fail overrides the wallet or the network.
 */
export function fundedWalletStateFor(
  network: X402AvailableNetwork,
  overrides: Partial<X402Wallet> = {},
) {
  return {
    wallet: purchasingWallet({
      networkId: network.id,
      caip2Network: network.caip2Id,
      ...overrides,
    }),
    balances: [
      {
        caip2Network: network.caip2Id,
        displayName: network.displayName,
        native: { symbol: "ETH", decimals: 18, amount: "1" },
        asset: {
          asset: network.defaultAsset ?? USDC_BASE_SEPOLIA,
          symbol: "USDC",
          decimals: network.defaultAssetDecimals ?? 6,
          amount: "1000000",
        },
        error: null,
      },
    ],
  };
}
