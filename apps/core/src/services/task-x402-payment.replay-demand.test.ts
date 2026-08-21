import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMessageMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureMessage: captureMessageMock }));

// Pin the environment split; the verify path reads getEnv().NETWORK.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NETWORK: "Preprod" as const }),
  };
});

import {
  AGENT_ID,
  agentRow,
  BASE_SEPOLIA,
  captureThrow,
  createTx,
  OTHER_PAY_TO,
  PAY_TO,
  storedRecord,
  USDC,
  verificationInput,
} from "./task-x402-payment.replay.fixtures";
import {
  assertReplayMatchesStoredDemand,
  findListedX402Agent,
} from "./task-x402-payment.replay-demand";

describe("findListedX402Agent", () => {
  it("mirrors the listing's correlated entry-type and discovery-URL gates", async () => {
    const tx = createTx();
    await findListedX402Agent(AGENT_ID, tx);
    expect(tx.agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: AGENT_ID,
          OR: [
            {
              type: "X402",
              x402ResourcesUrl: { not: null },
            },
            {
              type: "OPEN_API",
              openApiSpecUrl: { not: null },
              paymentSources: { some: { scheme: { not: null } } },
            },
          ],
          status: "ONLINE",
        },
      }),
    );
  });

  it.each([
    [
      "X402",
      {
        type: "X402",
        x402ResourcesUrl: null,
        openApiSpecUrl: "https://agent.example.com/openapi.json",
      },
    ],
    [
      "OPEN_API",
      {
        type: "OPEN_API",
        x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
        openApiSpecUrl: "file:///tmp/openapi.json",
      },
    ],
  ] as const)(
    "rejects a remembered %s agent without its valid type-specific discovery URL",
    async (_type, overrides) => {
      const tx = createTx(agentRow(overrides));

      await expect(findListedX402Agent(AGENT_ID, tx)).resolves.toBeNull();
    },
  );

  it("orders amounts deterministically, like the listing query", async () => {
    // `paymentSources` was ordered but `amounts` was a bare `include: true`,
    // so "the first amount row for this asset" — the matcher's `find` — was
    // Postgres heap order. The listing pins the SAME order, and the two must
    // agree on row identity or a listed price and a paid price can come from
    // different rows of the same source.
    const tx = createTx();
    await findListedX402Agent(AGENT_ID, tx);
    expect(tx.agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          paymentSources: {
            where: {
              scheme: { not: null },
            },
            include: { amounts: { orderBy: [{ unit: "asc" }, { id: "asc" }] } },
            orderBy: { sourceIndex: "asc" },
          },
        },
      }),
    );
  });
});

describe("assertReplayMatchesStoredDemand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the normalized 402 when it re-verifies to the stored tuple", async () => {
    const tx = createTx();
    const normalized = await assertReplayMatchesStoredDemand(
      storedRecord(),
      verificationInput(),
      tx,
    );
    expect(normalized.normalized.accepts[0]?.payTo).toBe(PAY_TO);
  });

  it("re-verifies a stored dynamic quote without a registered fixed amount", async () => {
    const tx = createTx(
      agentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            scheme: "exact",
            pricingType: "DYNAMIC",
            amounts: [],
          },
        ],
      }),
    );

    const normalized = await assertReplayMatchesStoredDemand(
      storedRecord(),
      verificationInput(),
      tx,
    );

    expect(normalized.normalized.accepts).toHaveLength(1);
    expect(normalized.normalized.accepts[0]?.amount).toBe("250000");
  });

  it("rethrows a non-422 verification crash instead of relabeling it as key reuse", async () => {
    // The catch around verifyX402DemandAgainstAgentSources maps ONLY its own
    // 422s to the held-PENDING 502 — advice that must never come from a
    // programming error. A poisoned property getter stands in for any future
    // crash inside the verifier.
    const poisoned = agentRow();
    Object.defineProperty(poisoned, "paymentSources", {
      get() {
        throw new TypeError("verifier crashed");
      },
    });
    const tx = createTx(poisoned);

    await expect(
      assertReplayMatchesStoredDemand(storedRecord(), verificationInput(), tx),
    ).rejects.toThrow("verifier crashed");
  });

  it("narrows to the re-verified entry, dropping a sibling for a different asset on the same chain", async () => {
    // The residual the narrowing exists for, and the one the same-pair fence
    // cannot reach. A sibling on the STORED pair is refused outright (next
    // test); a sibling for a DIFFERENT, unregistered asset on the same chain
    // conflicts with nothing, so the 402 re-verifies and the payload is
    // forwarded to the node — which picks the entry it signs, constrained only
    // by preferredNetwork/preferredAsset. Whether the attacker's entry gets
    // signed then depends on the node honouring preferredAsset: a fail-open
    // dependency on a node this repo does not deploy. Handing over one entry
    // makes the node's selection rule irrelevant — on the replay path exactly
    // as on the fresh one.
    const verified = {
      scheme: "exact",
      network: BASE_SEPOLIA,
      asset: USDC,
      amount: "250000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    };
    const tx = createTx();

    const normalized = await assertReplayMatchesStoredDemand(
      storedRecord(),
      verificationInput([
        verified,
        {
          scheme: "exact",
          network: BASE_SEPOLIA,
          asset: "0x9999999999999999999999999999999999999999",
          amount: "999999999",
          payTo: OTHER_PAY_TO,
          maxTimeoutSeconds: 3600,
        },
      ]),
      tx,
    );

    expect(normalized.normalized.accepts).toEqual([verified]);
  });

  it("holds a poisoned sibling at the catalog verify step (defense in depth)", async () => {
    // In production the resolver's catalog-free fingerprint proof rejects
    // this input before any catalog read; if this function is ever reached
    // with disagreeing same-pair entries anyway, it must still refuse to
    // sign — holding, never advising a new key on catalog evidence.
    const tx = createTx();
    const err = await captureThrow(
      assertReplayMatchesStoredDemand(
        storedRecord(),
        verificationInput([
          {
            scheme: "exact",
            network: BASE_SEPOLIA,
            asset: USDC,
            amount: "250000",
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
          },
          {
            scheme: "exact",
            network: BASE_SEPOLIA,
            asset: USDC,
            amount: "999999999",
            payTo: OTHER_PAY_TO,
            maxTimeoutSeconds: 60,
          },
        ]),
        tx,
      ),
    );
    expect(err.status).toBe(502);
    expect(err.cause?.kind).toBe("x402_pay_pending_held");
  });
});
