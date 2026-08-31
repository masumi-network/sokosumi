import type { CreditCost } from "@sokosumi/database";
import type { X402AvailableNetwork, X402KeySpendCaps } from "@sokosumi/masumi";
import { convertCreditsToCents } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { calculateCentsFromX402Amount } from "@/helpers/x402-pricing";

import { composeX402ReadySources as composeReadySourcesUnchecked } from "./agent-sync.x402-readiness.compose";
import {
  availableNetwork,
  BASE_MAINNET_USDC,
  cappedWith,
  fundedWalletBalances,
  fundedWalletStateFor,
  keySpendCaps,
  mainnetNetwork,
  PURCHASING_WALLET_ADDRESS,
  purchasingWallet,
  READY_SOURCE,
  USDC_BASE_SEPOLIA,
} from "./agent-sync.x402-readiness.fixtures";

const MAINNET_READY_SOURCE = {
  caip2Network: "eip155:8453",
  asset: BASE_MAINNET_USDC,
  evmWalletId: "wallet_mainnet",
  evmWalletAddress: PURCHASING_WALLET_ADDRESS,
  decimals: 6,
};

/**
 * NOT the real export — this wrapper SHADOWS `composeX402ReadySources` and
 * supplies the two gates most tests below are not about: an UNCAPPED key, and
 * one funded Purchasing wallet per enabled chain. Against the real defaults
 * (`spendCaps` null, `purchasingWallets = []`) every network-shaped test would
 * return `[]` for the wrong reason.
 *
 * Tests exercising the cap gate or the wallet binding itself pass `caps` /
 * `walletStates` explicitly, or call `composeReadySourcesUnchecked` directly,
 * or the fabrication masks the very path under test.
 */
function composeX402ReadySources(
  networks: readonly X402AvailableNetwork[],
  environment: "Preprod" | "Mainnet",
  options: {
    caps?: X402KeySpendCaps | null;
    walletStates?: Parameters<typeof composeReadySourcesUnchecked>[3];
  } = {},
) {
  // Keyed by wallet id: a network the node lists twice would otherwise
  // generate the SAME wallet id twice, which the real compose treats as a
  // malformed listing and poisons.
  const generatedWalletStates = [
    ...new Map(
      networks.map((network) => {
        const walletId =
          network.caip2Id.toLowerCase() === "eip155:8453"
            ? "wallet_mainnet"
            : "wallet_admin";
        return [walletId, fundedWalletStateFor(network, { id: walletId })];
      }),
    ).values(),
  ];
  return composeReadySourcesUnchecked(
    networks,
    options.caps === undefined ? keySpendCaps() : options.caps,
    environment,
    options.walletStates ?? generatedWalletStates,
  );
}

describe("composeX402ReadySources", () => {
  it("pairs an enabled network with a funded Purchasing wallet", () => {
    expect(composeX402ReadySources([availableNetwork()], "Preprod")).toEqual([
      READY_SOURCE,
    ]);
  });

  it("drops a funded node-default asset without trusted EIP-712 metadata and names the gap", () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const unknownAsset = "0x2222222222222222222222222222222222222222";
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: unknownAsset })],
        "Preprod",
      ),
    ).toEqual([]);
    // Soko-side config gap, not node state: silent, it is indistinguishable
    // from "node not ready", so the warn must name the pair and the map.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `no trusted EIP-712 domain; add it to X402_TRUSTED_EXACT_EVM_DOMAINS`,
      ),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(unknownAsset),
    );
    consoleWarnSpy.mockRestore();
  });

  describe("the key's spend cap", () => {
    it("composes nothing when the caps could not be read", () => {
      // Fail closed. A cycle that could not read the cap must never compose a
      // pair as payable.
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: null,
        }),
      ).toEqual([]);
    });

    it("marks the pair ready for an uncapped key", () => {
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: keySpendCaps({ usageLimited: false }),
        }),
      ).toEqual([READY_SOURCE]);
    });

    it("marks the pair ready for a capped key holding credits for its unit", () => {
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: cappedWith(1n),
        }),
      ).toEqual([READY_SOURCE]);
    });

    it("drops the pair and names the unit when the credits are spent to zero", () => {
      // A zero-credit key passes every wallet-side checklist item. The wallet
      // is listed and funded, so without this warn it is a silent zero-pairs
      // deployment.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: cappedWith(0n),
        }),
      ).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`eip155:84532:${USDC_BASE_SEPOLIA}`),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PATCH /api/v1/api-key"),
      );
      consoleWarnSpy.mockRestore();
    });

    it("drops the pair when the key holds credits only for ANOTHER chain", () => {
      // The cap is per (chain, asset) unit, not one pooled EVM budget, so
      // mainnet credits must not unlock a testnet pair.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: keySpendCaps({
            usageLimited: true,
            creditsByUnit: new Map([
              [`eip155:8453:${BASE_MAINNET_USDC}`, 9_000_000n],
            ]),
          }),
        }),
      ).toEqual([]);
      consoleWarnSpy.mockRestore();
    });

    it("drops the pair when the key holds no eip155 credit row at all", () => {
      // Was the opposite assertion: the node used to grandfather such a key to
      // uncapped spend, so this gate let it through and warned instead. The
      // node now refuses every payment it makes, so the pair is not payable
      // and must not be listed.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: keySpendCaps({ usageLimited: true }),
        }),
      ).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("has no remaining usage credits"),
      );
      consoleWarnSpy.mockRestore();
    });

    it("keeps the cap warns silent for an ordinary funded capped key", () => {
      // Kills the mutant that warns whenever the key is usageLimited at all.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          caps: cappedWith(1_000_000n),
        }),
      ).toEqual([READY_SOURCE]);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe("choosing the signing wallet", () => {
    it("fails closed and names the chain when no Purchasing wallet is listed", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [],
        }),
      ).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no usable Purchasing wallet"),
      );
      consoleWarnSpy.mockRestore();
    });

    it("keeps the wallet warn silent when a wallet backs the pair", () => {
      // Kills the mutant that fires the warn whenever ANY input is imperfect.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(composeX402ReadySources([availableNetwork()], "Preprod")).toEqual([
        READY_SOURCE,
      ]);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it.each([
      ["native gas", { native: { symbol: "ETH", decimals: 18, amount: "0" } }],
      [
        "matching token",
        {
          asset: {
            asset: USDC_BASE_SEPOLIA,
            symbol: "USDC",
            decimals: 6,
            amount: "0",
          },
        },
      ],
      [
        "matching asset",
        {
          asset: {
            asset: "0x1111111111111111111111111111111111111111",
            symbol: "OTHER",
            decimals: 6,
            amount: "1000000",
          },
        },
      ],
      [
        "agreeing scale",
        {
          asset: {
            asset: USDC_BASE_SEPOLIA,
            symbol: "USDC",
            decimals: 18,
            amount: "1000000",
          },
        },
      ],
    ])("requires a positive %s balance", (_label, overrides) => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [
            {
              wallet: purchasingWallet(),
              balances: fundedWalletBalances(overrides),
            },
          ],
        }),
      ).toEqual([]);
      consoleWarnSpy.mockRestore();
    });

    it("ignores a Selling wallet and a wallet on another chain", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [
            {
              wallet: purchasingWallet({ type: "Selling" }),
              balances: fundedWalletBalances(),
            },
            {
              wallet: purchasingWallet({
                id: "wallet_elsewhere",
                caip2Network: "eip155:8453",
              }),
              balances: fundedWalletBalances(),
            },
          ],
        }),
      ).toEqual([]);
      consoleWarnSpy.mockRestore();
    });

    it("records the most-funded wallet when several back one chain", () => {
      // With the cap moved onto the API key nothing binds a chain to one
      // wallet, so several funded wallets is a healthy deployment, not an
      // ambiguity to fail on. The richest is likeliest to cover a demand.
      const result = composeX402ReadySources([availableNetwork()], "Preprod", {
        walletStates: [
          {
            wallet: purchasingWallet({ id: "wallet_small" }),
            balances: fundedWalletBalances({
              asset: {
                asset: USDC_BASE_SEPOLIA,
                symbol: "USDC",
                decimals: 6,
                amount: "5",
              },
            }),
          },
          {
            wallet: purchasingWallet({ id: "wallet_large" }),
            balances: fundedWalletBalances({
              asset: {
                asset: USDC_BASE_SEPOLIA,
                symbol: "USDC",
                decimals: 6,
                amount: "9000000",
              },
            }),
          },
        ],
      });

      expect(result).toEqual([
        { ...READY_SOURCE, evmWalletId: "wallet_large" },
      ]);
    });

    it("tie-breaks equally funded wallets on the wallet id deterministically", () => {
      // The recorded pair feeds the serialized change-detection key, so an
      // unstable winner would page on every cycle with no readiness change.
      const result = composeX402ReadySources([availableNetwork()], "Preprod", {
        walletStates: [
          {
            wallet: purchasingWallet({ id: "wallet_b" }),
            balances: fundedWalletBalances(),
          },
          {
            wallet: purchasingWallet({ id: "wallet_a" }),
            balances: fundedWalletBalances(),
          },
        ],
      });

      expect(result).toEqual([{ ...READY_SOURCE, evmWalletId: "wallet_a" }]);
    });

    it("trims surrounding whitespace from the recorded wallet id", () => {
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [
            {
              wallet: purchasingWallet({ id: "  wallet_admin  " }),
              balances: fundedWalletBalances(),
            },
          ],
        }),
      ).toEqual([READY_SOURCE]);
    });

    it("preserves mixed-case wallet ids on the recorded pair", () => {
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [
            {
              wallet: purchasingWallet({ id: "Wallet_Admin" }),
              balances: fundedWalletBalances(),
            },
          ],
        }),
      ).toEqual([{ ...READY_SOURCE, evmWalletId: "Wallet_Admin" }]);
    });

    it("poisons a wallet id the node lists twice", () => {
      // A wallet id is the node's primary key, so a duplicate is malformed.
      // The recorded pair carries the id AND the address the pay path binds
      // the signed payer to, so taking them from an arbitrary row can pair an
      // id with the wrong address and fail every payment on that pair.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [
            {
              wallet: purchasingWallet({ id: "wallet_dup" }),
              balances: fundedWalletBalances(),
            },
            {
              wallet: purchasingWallet({
                id: "wallet_dup",
                address: "0x1111111111111111111111111111111111111111",
              }),
              balances: fundedWalletBalances(),
            },
          ],
        }),
      ).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no usable Purchasing wallet"),
      );
      consoleWarnSpy.mockRestore();
    });

    it("keeps a distinct sibling usable when another id is poisoned", () => {
      // Kills the mutant that drops the whole chain on any duplicate.
      expect(
        composeX402ReadySources([availableNetwork()], "Preprod", {
          walletStates: [
            {
              wallet: purchasingWallet({ id: "wallet_dup" }),
              balances: fundedWalletBalances(),
            },
            {
              wallet: purchasingWallet({ id: "wallet_dup" }),
              balances: fundedWalletBalances(),
            },
            {
              wallet: purchasingWallet({ id: "wallet_admin" }),
              balances: fundedWalletBalances(),
            },
          ],
        }),
      ).toEqual([READY_SOURCE]);
    });

    it("drops a wallet whose id is blank or whitespace only", () => {
      // Without a signable id the pay route cannot sign, so the pair must not
      // be recorded ready.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      for (const id of ["", "   "]) {
        expect(
          composeX402ReadySources([availableNetwork()], "Preprod", {
            walletStates: [
              {
                wallet: purchasingWallet({ id }),
                balances: fundedWalletBalances(),
              },
            ],
          }),
        ).toEqual([]);
      }
      consoleWarnSpy.mockRestore();
    });
  });

  it("drops a pair on a disabled network", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ isEnabled: false })],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("drops a mainnet pair on Preprod even when the node offers it", () => {
    // Environment separation must not rest on the node honouring
    // `query: { isTestnet }`. A node that ignores or misreads that filter
    // would otherwise put a Base MAINNET pair — real funds — into the
    // Preprod readiness cache.
    const result = composeX402ReadySources(
      [availableNetwork({ caip2Id: "EIP155:84532" }), mainnetNetwork()],
      "Preprod",
    );

    // Casing normalized, mainnet gone.
    expect(result).toEqual([READY_SOURCE]);
  });

  it("drops a testnet pair on Mainnet and keeps the mainnet one", () => {
    const result = composeX402ReadySources(
      [availableNetwork(), mainnetNetwork()],
      "Mainnet",
    );

    expect(result).toEqual([MAINNET_READY_SOURCE]);
  });

  it("carries the node's decimals onto the recorded pair", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAssetDecimals: 8 })],
        "Preprod",
      ),
    ).toEqual([{ ...READY_SOURCE, decimals: 8 }]);
  });

  it("matches the node's default asset canonically, not by raw spelling", () => {
    // The node may serve a checksummed address while the balance row is
    // lowercase (or the reverse). Both sides are canonicalized before
    // comparing, or a spelling difference would silently unlist the one
    // payable pair.
    expect(
      composeX402ReadySources(
        [
          availableNetwork({
            defaultAsset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
          }),
        ],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });

  it("drops the pair when the node reports no usable decimals", () => {
    // Fail closed rather than guessing or falling back to the agent's
    // registered value: `defaultAssetDecimals` is nullable in the node's spec
    // ("null until an operator confirms them"), and a wrong scale mis-prices
    // by 10^n.
    for (const defaultAssetDecimals of [null, 6.5, -1, 256, Number.NaN]) {
      expect(
        composeX402ReadySources(
          [availableNetwork({ defaultAssetDecimals })],
          "Preprod",
        ),
      ).toEqual([]);
    }
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: null })],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: "USDC" })],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("drops a network the node lists twice with disagreeing decimals", () => {
    // Two entries for one chain is malformed. Picking either one is picking
    // a charge scale at random — and one of the two is 10^n wrong.
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ defaultAssetDecimals: 18 })],
        "Preprod",
      ),
    ).toEqual([]);
    // Agreeing duplicates are one network, not a conflict.
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ id: "x402net_dup" })],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });

  it("drops a network the node lists twice with disagreeing isEnabled", () => {
    // Same doctrine as the decimals conflict: a node contradicting itself
    // about whether a chain is enabled must not be resolved in favor of
    // enabled by row order — the chain is poisoned, in either arrival order.
    expect(
      composeX402ReadySources(
        [availableNetwork({ isEnabled: false }), availableNetwork()],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ isEnabled: false })],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("prices off the node's decimals, never the agent-registered ones", () => {
    // The exploit this pair exists to close. `decimals` scales the charge
    // INVERSELY, and the agent authors its own registry entry: registering
    // USDC on Base Sepolia with decimals 18 (true value 6) makes a demand for
    // 1 whole USDC price at the platform floor while Soko's managed wallet
    // signs away a real USDC.
    const [source] = composeX402ReadySources([availableNetwork()], "Preprod");
    if (!source) {
      expect.unreachable("the funded pair must be recorded");
    }

    const creditCosts: CreditCost[] = [
      {
        id: "credit-cost-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        unit: `eip155:84532/erc20:${USDC_BASE_SEPOLIA}`,
        // 1 whole USDC = 1 credit = 10^10 cents.
        centsPerUnit: 10_000_000_000n,
      },
    ];
    const oneWholeUsdc = "1000000";
    const AGENT_AUTHORED_DECIMALS = 18;

    // The ready pair goes in whole — identity and scale from one row, which is
    // the only shape the pricing helper now accepts.
    const trustedCents = calculateCentsFromX402Amount(
      { pair: source, amount: oneWholeUsdc },
      creditCosts,
    );
    const exploitedCents = calculateCentsFromX402Amount(
      {
        pair: { ...source, decimals: AGENT_AUTHORED_DECIMALS },
        amount: oneWholeUsdc,
      },
      creditCosts,
    );

    // The money first: 1 whole USDC must cost 1 credit.
    expect(trustedCents).toBe(10_000_000_000n);
    // What the agent's number would have charged instead — the platform
    // floor, a 10^10x under-charge, repeatable on every call while the
    // managed wallet signs away a real USDC each time.
    expect(exploitedCents).toBe(
      convertCreditsToCents(LIMITS.MIN_CHARGEABLE_CREDITS),
    );
    expect(source.decimals).toBe(6);
    expect(source.decimals).not.toBe(AGENT_AUTHORED_DECIMALS);
  });

  it("ignores canSettle — buy-side readiness needs no facilitator", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ canSettle: false })],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });
});
