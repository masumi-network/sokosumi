import type { CreditCost } from "@sokosumi/database";
import type { X402AvailableNetwork, X402Budget } from "@sokosumi/masumi";
import { convertCreditsToCents } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { calculateCentsFromX402Amount } from "@/helpers/x402-pricing";

import { composeX402ReadySources as composeReadySourcesUnchecked } from "./agent-sync.x402-readiness.compose";
import {
  ADMIN_WALLET_ADDRESS,
  availableNetwork,
  BASE_MAINNET_USDC,
  budget,
  fundedWalletBalances,
  mainnetBudget,
  mainnetNetwork,
  purchasingWallet,
  READY_SOURCE,
  USDC_BASE_SEPOLIA,
  walletStateForBudget,
} from "./agent-sync.x402-readiness.fixtures";

/**
 * NOT the real export — this wrapper SHADOWS `composeX402ReadySources` and
 * FABRICATES a funded, asset-matching Purchasing-wallet state for every
 * budget before delegating to the real function (imported above as
 * `composeReadySourcesUnchecked`). Against the real default
 * (`adminPurchasingWallets = []`) most tests below would return `[]`.
 * Tests exercising the budget-to-wallet binding itself must pass explicit
 * `walletStates` (or call `composeReadySourcesUnchecked` directly), or the
 * fabrication masks the very path under test.
 */
function composeX402ReadySources(
  networks: readonly X402AvailableNetwork[],
  budgets: readonly X402Budget[],
  environment: "Preprod" | "Mainnet",
  walletStates?: Parameters<typeof composeReadySourcesUnchecked>[3],
) {
  const generatedWalletStates = Array.from(
    new Map(
      budgets.map((budgetRow) => [
        budgetRow.evmWalletId,
        walletStateForBudget(budgetRow, networks),
      ]),
    ).values(),
  );
  return composeReadySourcesUnchecked(
    networks,
    budgets,
    environment,
    walletStates ?? generatedWalletStates,
  );
}

describe("composeX402ReadySources", () => {
  it("pairs an enabled network with a funded budget", () => {
    expect(
      composeX402ReadySources([availableNetwork()], [budget()], "Preprod"),
    ).toEqual([READY_SOURCE]);
  });

  it("drops a funded node-default asset without trusted EIP-712 metadata and names the gap", () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const unknownAsset = "0x2222222222222222222222222222222222222222";
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: unknownAsset })],
        [budget({ asset: unknownAsset })],
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

  it("fails closed when a funded budget has no matching Purchasing wallet", () => {
    // This input also fires the empty-wallet-listing warn (pinned in its own
    // test below); the spy keeps the suite's output clean.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(
      composeReadySourcesUnchecked(
        [availableNetwork()],
        [budget()],
        "Preprod",
        [],
      ),
    ).toEqual([]);
    consoleWarnSpy.mockRestore();
  });

  it("names the empty-wallet-listing trap when funded budgets cannot bind", () => {
    // Enabled priced chain + funded budget + zero usable Purchasing wallets:
    // the operator created none (or only Selling-type ones), or version skew
    // withheld `canAdmin` and emptied the client's listing. A plain
    // non-admin key never reaches compose — the node admin-gates
    // GET /x402/budgets, so the sync fails its check step first. Fail-closed
    // is correct (budget readiness must verify live wallet balances) — but
    // it must say so, or the operator debugs green node checks and an empty
    // cache.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(
      composeReadySourcesUnchecked(
        [availableNetwork()],
        [budget()],
        "Preprod",
        [],
      ),
    ).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "create and confirm exactly one funded Purchasing wallet per enabled chain",
      ),
    );
    // Exactly one warn: the per-budget binding warn is gated on a non-empty
    // listing, so the empty-listing case never double-reports.
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    consoleWarnSpy.mockRestore();
  });

  it("keeps the wallet-listing warn silent when a budget binds to a wallet", () => {
    // Kills the mutant that fires the warn whenever ANY input is imperfect:
    // with a bindable wallet the pair composes and the warn must stay down.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(
      composeX402ReadySources([availableNetwork()], [budget()], "Preprod"),
    ).toEqual([READY_SOURCE]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("keeps the wallet-listing warn silent when no budget survives the gates", () => {
    // Kills the mutant that drops the `configuredBudgetPairs.size > 0`
    // conjunct: an empty wallet listing WITHOUT any bindable budget is the
    // ordinary no-budget deployment, not the trap.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(
      composeReadySourcesUnchecked([availableNetwork()], [], "Preprod", []),
    ).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("fails closed when budget and Purchasing wallet addresses differ", () => {
    // The failed binding also fires the per-budget warn (pinned in its own
    // test below); the spy keeps the suite's output clean.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(
      composeReadySourcesUnchecked(
        [availableNetwork()],
        [budget()],
        "Preprod",
        [
          {
            wallet: purchasingWallet({ id: "wallet_1" }),
            balances: fundedWalletBalances(),
          },
        ],
      ),
    ).toEqual([]);
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
  ])(
    "requires positive %s balance for budget readiness",
    (_label, overrides) => {
      // The unfunded binding also fires the per-budget warn (pinned in its
      // own test below); the spy keeps the suite's output clean.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const budgetRow = budget();
      expect(
        composeReadySourcesUnchecked(
          [availableNetwork()],
          [budgetRow],
          "Preprod",
          [
            {
              wallet: purchasingWallet({
                id: budgetRow.evmWalletId,
                address: budgetRow.evmWalletAddress,
              }),
              balances: fundedWalletBalances(overrides),
            },
          ],
        ),
      ).toEqual([]);
      consoleWarnSpy.mockRestore();
    },
  );

  it.each(["absent", "non-Purchasing"])(
    "does not bypass a configured budget whose wallet is %s via admin fallback",
    (walletState) => {
      const states = [
        {
          wallet: purchasingWallet(),
          balances: fundedWalletBalances(),
        },
        ...(walletState === "non-Purchasing"
          ? [
              {
                wallet: purchasingWallet({
                  id: "wallet_1",
                  address: budget().evmWalletAddress,
                  type: "Selling",
                }),
                balances: fundedWalletBalances(),
              },
            ]
          : []),
      ];
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      expect(
        composeReadySourcesUnchecked(
          [availableNetwork()],
          [budget()],
          "Preprod",
          states,
        ),
      ).toEqual([]);
      // This is the state the empty-listing warn CANNOT cover: a funded
      // Purchasing wallet IS listed on the chain, so the operator's "one
      // funded wallet exists" checklist passes while the budget's own
      // binding fails and blocks both paths. The per-budget warn is the
      // only diagnostic — exactly one, naming the remediation.
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "re-point or delete the budget, or fund its wallet",
        ),
      );
      consoleWarnSpy.mockRestore();
    },
  );

  it("uses a unique admin purchasing wallet without requiring a budget", () => {
    expect(
      composeX402ReadySources([availableNetwork()], [], "Preprod", [
        { wallet: purchasingWallet(), balances: fundedWalletBalances() },
      ]),
    ).toEqual([
      {
        ...READY_SOURCE,
        evmWalletId: "wallet_admin",
        evmWalletAddress: ADMIN_WALLET_ADDRESS,
      },
    ]);
  });

  it("composes nothing without a budget or an admin Purchasing wallet", () => {
    // No budget and an empty wallet listing (what the client returns when
    // `canAdmin !== true`): neither path has anything to bind, so no pair.
    expect(
      composeX402ReadySources([availableNetwork()], [], "Preprod", []),
    ).toEqual([]);
  });

  it("fails closed when admin has multiple purchasing wallets on one chain", () => {
    expect(
      composeX402ReadySources([availableNetwork()], [], "Preprod", [
        {
          wallet: purchasingWallet({ id: "wallet_a" }),
          balances: fundedWalletBalances(),
        },
        {
          wallet: purchasingWallet({ id: "wallet_b" }),
          balances: fundedWalletBalances(),
        },
      ]),
    ).toEqual([]);
  });

  it("does not bypass an exhausted admin budget on the selected wallet", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [
          budget({
            evmWalletId: "wallet_admin",
            remainingAmount: "0",
          }),
        ],
        "Preprod",
        [
          {
            wallet: purchasingWallet(),
            balances: fundedWalletBalances(),
          },
        ],
      ),
    ).toEqual([]);
  });

  it("drops budgets on disabled or unknown networks", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ isEnabled: false })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [budget({ caip2Network: "eip155:8453" })],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("drops exhausted and malformed budgets", () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [
          budget({ remainingAmount: "0" }),
          budget({ remainingAmount: "-5" }),
          budget({ remainingAmount: "not-a-number" }),
          budget({ asset: "USDC" }),
          // Without a backing wallet id the pay route cannot sign — the
          // pair must not be recorded ready.
          budget({ evmWalletId: "" }),
          budget({ evmWalletId: "   " }),
        ],
        "Preprod",
      ),
    ).toEqual([]);
    // Warn content is pinned separately (the wrapper's last-wins wallet
    // fabrication makes several of these rows unbindable rather than
    // exhausted); the spy only keeps the suite's output clean here.
    consoleWarnSpy.mockRestore();
  });

  it("trims surrounding whitespace from the recorded wallet id", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [budget({ evmWalletId: "  wallet_1  " })],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });

  it("preserves mixed-case wallet ids on the recorded pair", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [budget({ evmWalletId: "Wallet_1" })],
        "Preprod",
      ),
    ).toEqual([{ ...READY_SOURCE, evmWalletId: "Wallet_1" }]);
  });

  it("names the exhausted budget when it is the pair's only backing", () => {
    // A spent budget passes every wallet-side checklist item — the wallet is
    // listed, funded, and correctly referenced — so without its own warn
    // this is a silent zero-pairs deployment (the exhausted budget also
    // blocks the admin fallback via `configuredBudgetPairs`).
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const budgetRow = budget({ remainingAmount: "0" });
    expect(
      composeReadySourcesUnchecked(
        [availableNetwork()],
        [budgetRow],
        "Preprod",
        [
          {
            wallet: purchasingWallet({
              id: budgetRow.evmWalletId,
              address: budgetRow.evmWalletAddress,
            }),
            balances: fundedWalletBalances(),
          },
        ],
      ),
    ).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("top up or delete the budget"),
    );
    consoleWarnSpy.mockRestore();
  });

  it.each(["before", "after"])(
    "keeps budget warns silent when a sibling row binds the pair (stale row %s)",
    (staleOrder) => {
      // Several budgets may back one pair, and the most-funded wallet wins —
      // a stale second row (retired wallet, or spent to zero) on a HEALTHY
      // deployment must not warn that the pair "cannot be buy-side ready"
      // while the pair is listed and payable. Kills the mutant that warns at
      // row level instead of pair level, in both row orders.
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const bindingRow = budget();
      const staleRows = [
        budget({ evmWalletId: "wallet_retired" }),
        budget({ remainingAmount: "0" }),
      ];
      const rows =
        staleOrder === "before"
          ? [...staleRows, bindingRow]
          : [bindingRow, ...staleRows];
      expect(
        composeReadySourcesUnchecked([availableNetwork()], rows, "Preprod", [
          {
            wallet: purchasingWallet({
              id: bindingRow.evmWalletId,
              address: bindingRow.evmWalletAddress,
            }),
            balances: fundedWalletBalances(),
          },
        ]),
      ).toEqual([READY_SOURCE]);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    },
  );

  it("records the most-funded wallet when several budgets back one pair", () => {
    const result = composeX402ReadySources(
      [availableNetwork()],
      [
        budget({ id: "b1", evmWalletId: "wallet_small", remainingAmount: "5" }),
        budget({
          id: "b2",
          evmWalletId: "wallet_large",
          remainingAmount: "9000000",
        }),
        budget({ id: "b3", evmWalletId: "wallet_1", remainingAmount: "100" }),
      ],
      "Preprod",
    );

    expect(result).toEqual([{ ...READY_SOURCE, evmWalletId: "wallet_large" }]);
  });

  it("tie-breaks equal budgets on the wallet id deterministically", () => {
    const result = composeX402ReadySources(
      [availableNetwork()],
      [
        budget({ id: "b1", evmWalletId: "wallet_b", remainingAmount: "100" }),
        budget({ id: "b2", evmWalletId: "wallet_a", remainingAmount: "100" }),
      ],
      "Preprod",
    );

    expect(result).toEqual([{ ...READY_SOURCE, evmWalletId: "wallet_a" }]);
  });

  it("drops a mainnet pair on Preprod even when the node offers it", () => {
    // Environment separation must not rest on the node honouring
    // `query: { isTestnet }`. A node that ignores or misreads that filter
    // would otherwise put a Base MAINNET pair — real funds — into the
    // Preprod readiness cache.
    const result = composeX402ReadySources(
      [availableNetwork({ caip2Id: "EIP155:84532" }), mainnetNetwork()],
      [
        budget({
          asset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
        }),
        budget({ id: "x402budget_2" }),
        mainnetBudget(),
      ],
      "Preprod",
    );

    // Casing normalized, duplicates collapsed, mainnet gone.
    expect(result).toEqual([READY_SOURCE]);
  });

  it("drops a testnet pair on Mainnet and keeps the mainnet one", () => {
    const result = composeX402ReadySources(
      [availableNetwork(), mainnetNetwork()],
      [budget(), mainnetBudget()],
      "Mainnet",
    );

    expect(result).toEqual([
      {
        caip2Network: "eip155:8453",
        asset: BASE_MAINNET_USDC,
        evmWalletId: "wallet_mainnet",
        evmWalletAddress: budget().evmWalletAddress.toLowerCase(),
        decimals: 6,
      },
    ]);
  });

  it("drops a funded budget in an asset the node publishes no decimals for", () => {
    // The node publishes decimals for its DEFAULT asset only, so a budget in
    // any other asset has no trustworthy scale anywhere — the only other
    // source is the agent's own registry entry, which is exactly the input
    // this pair stops trusting. Pricing needs the scale (`cents = amount x
    // centsPerUnit / 10^decimals`), so an asset without one is not payable.
    const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";
    const result = composeX402ReadySources(
      [mainnetNetwork()],
      [mainnetBudget({ id: "x402budget_usdt", asset: usdt }), mainnetBudget()],
      "Mainnet",
    );

    expect(result.map((source) => source.asset)).toEqual([BASE_MAINNET_USDC]);
  });

  it("carries the node's decimals onto the recorded pair", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAssetDecimals: 8 })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([{ ...READY_SOURCE, decimals: 8 }]);
  });

  it("matches the node's default asset canonically, not by raw spelling", () => {
    // The node may serve a checksummed address while the budget is lowercase
    // (or the reverse). Both sides are canonicalized before comparing, or a
    // spelling difference would silently unlist the one payable pair.
    expect(
      composeX402ReadySources(
        [
          availableNetwork({
            defaultAsset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
          }),
        ],
        [budget()],
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
          [budget()],
          "Preprod",
        ),
      ).toEqual([]);
    }
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: null })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: "USDC" })],
        [budget()],
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
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    // Agreeing duplicates are one network, not a conflict.
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ id: "x402net_dup" })],
        [budget()],
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
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ isEnabled: false })],
        [budget()],
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
    const [source] = composeX402ReadySources(
      [availableNetwork()],
      [budget()],
      "Preprod",
    );
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
        [budget()],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });
});
