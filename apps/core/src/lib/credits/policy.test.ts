import type { Prisma } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { forbidden } from "@/helpers/error";
import type { MainnetScope, NetworkScope } from "@/lib/db/network-scope";

import {
  cusoFunding,
  getBalance,
  getCredits,
  getOrganizationPoolBalance,
  lowBalanceFunding,
  sumOrganizationEnterprisePoolBalances,
  sumOrganizationOwnedCreditBalances,
} from "./balance";
import { buildCreditsPayload, getCurrentSubscriptionCredits } from "./funding";
import { expireEnterpriseGrants, grant } from "./grant";
import { taskEventCountsOn, taskEventCountsOnSql } from "./policy";
import { refund } from "./refund";
import { creditViewForRequest } from "./view";
import { writeOff } from "./write-off";

/**
 * A database handle that fails any use: the operation under test must
 * decide from the scope alone, reading and writing nothing.
 */
function untouchable<T>(): T {
  return new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`touched the database: ${String(key)}`);
      },
    },
  ) as T;
}

/** A Preprod scope whose clients fail any use. */
function preprodScope(): NetworkScope {
  return {
    network: "preprod",
    get networkDb() {
      return untouchable();
    },
    get sharedDb() {
      return untouchable();
    },
  } as unknown as NetworkScope;
}

const tx = untouchable<Prisma.TransactionClient>();

describe("while Preprod is off", () => {
  it("no Preprod scope can be built, so the module never sees one: the refusal is the scope's", async () => {
    const { createNetworkScope } = await import("@/lib/db/network-scope");

    expect(() => createNetworkScope("preprod")).toThrow(
      "Preprod is off: NETWORK_PREPROD_ENABLED is not true",
    );
  });
});

describe("Preprod has no grants and no write-offs", () => {
  it("refuses every grant before anything is written", async () => {
    const thrown = await grant({
      scope: preprodScope(),
      tx,
      kind: "free",
      target: { targetType: "user", userId: "user-1" },
      credits: 10,
      expiresAt: null,
      grantId: "grant-1",
      note: "support",
      wakeTasks: true,
    } as Parameters<typeof grant>[0]).catch((error) => error);

    expect(thrown).toMatchObject({
      message:
        "A credit grant is Mainnet's only: preprod charges no credits, so it has none",
    });
  });

  it("refuses to expire enterprise credits", async () => {
    await expect(
      expireEnterpriseGrants({
        scope: preprodScope(),
        tx,
        periodIds: ["period-1"],
        topUpContractId: null,
        now: new Date(),
      }),
    ).rejects.toThrow("Expiring enterprise credits is Mainnet's only");
  });

  it("refuses a write-off, even with a scope that claims Mainnet's type", async () => {
    await expect(
      writeOff({
        scope: preprodScope() as MainnetScope,
        tx,
        of: { projectId: "project-1" },
      }),
    ).rejects.toThrow("A credit write-off is Mainnet's only");
  });
});

describe("a refund on Preprod", () => {
  it("gives nothing back and writes nothing: nothing was taken", async () => {
    const refunded = await refund({
      scope: preprodScope(),
      tx,
      charge: {
        amount: -100n,
        userId: "user-1",
        organizationId: null,
        creditConsumptions: [],
      },
      referenceId: "job-1",
    });

    expect(refunded).toBeNull();
  });

  it("passes a refusing scope's error, before anything is written", async () => {
    const refusal = forbidden("Preprod is switched off");
    const refusing = {
      get network(): never {
        throw refusal;
      },
    } as unknown as NetworkScope;

    await expect(
      refund({
        scope: refusing,
        tx,
        charge: {
          amount: -100n,
          userId: "user-1",
          organizationId: null,
          creditConsumptions: [],
        },
        referenceId: "job-1",
      }),
    ).rejects.toBe(refusal);
  });
});

describe("Preprod has no balance", () => {
  const scope = preprodScope();
  const db = untouchable<Prisma.TransactionClient>();

  it.each([
    ["getBalance", () => getBalance(scope, "user-1", null, db)],
    ["getCredits", () => getCredits(scope, "user-1", null, db)],
    [
      "getOrganizationPoolBalance",
      () => getOrganizationPoolBalance(scope, "org-1", db),
    ],
    [
      "sumOrganizationEnterprisePoolBalances",
      () =>
        sumOrganizationEnterprisePoolBalances(scope, "org-1", db, new Date()),
    ],
    [
      "sumOrganizationOwnedCreditBalances",
      () => sumOrganizationOwnedCreditBalances(scope, "org-1", db),
    ],
    ["cusoFunding", () => cusoFunding(scope, "project-1", new Date())],
  ] as const)("refuses %s", async (_name, read) => {
    await expect((async () => read())()).rejects.toThrow(
      "A credit balance is Mainnet's only: preprod charges no credits, so it has none",
    );
  });

  it("refuses a plan's credits read directly, not only through the payload", async () => {
    await expect(
      getCurrentSubscriptionCredits({
        scope,
        subscription: {
          periodStart: new Date("2026-11-01T00:00:00Z"),
          periodEnd: new Date("2026-12-01T00:00:00Z"),
        },
        userId: "user-1",
        organizationId: null,
      }),
    ).rejects.toThrow("A plan's credits is Mainnet's only");
  });

  it("answers no funding to a low-balance check, so nothing warns", async () => {
    expect(
      await lowBalanceFunding(scope, {
        userId: "user-1",
        organizationId: null,
      }),
    ).toBeNull();
  });

  it.each([
    ["personal", null],
    ["organization", "org-1"],
  ] as const)(
    "answers the %s credits payload with no balance, plan or enterprise data, reading nothing",
    async (wallet, organizationId) => {
      expect(
        await buildCreditsPayload({
          scope,
          userId: "user-1",
          organizationId,
          referenceId: organizationId ?? "user-1",
        }),
      ).toEqual({
        scope: wallet,
        spendable: 0,
        subscription: null,
        extra: {
          credits: { total: 0, remaining: 0, used: 0 },
          buckets: [],
          enterprise: null,
        },
        enterprise: null,
        credits: { subscription: null, buffer: 0, total: 0 },
      });
    },
  );
});

describe("the credit view of a request", () => {
  it("is the request's Network, named, and not charged on Preprod", () => {
    const scope = preprodScope();
    const view = creditViewForRequest(scope);

    expect(view.billingScope).toBe(scope);
    expect(view.network).toBe("preprod");
    expect(view.affectsBalance).toBe(false);
  });

  it("is Mainnet's, charged, for a Mainnet request", () => {
    const scope = { network: "mainnet" } as NetworkScope;
    const view = creditViewForRequest(scope);

    expect(view.billingScope).toBe(scope);
    expect(view.network).toBe("mainnet");
    expect(view.affectsBalance).toBe(true);
  });

  it("passes a refused scope's own error, before any read: no Mainnet view", () => {
    const refusal = forbidden("You have no Preprod access in this workspace");
    const refusing = {
      get network(): never {
        throw refusal;
      },
    } as unknown as NetworkScope;

    expect(() => creditViewForRequest(refusing)).toThrow(refusal);
  });
});

describe("which Task events count on a Network", () => {
  it.each([
    [null, "mainnet", true],
    ["mainnet", "mainnet", true],
    ["preprod", "mainnet", false],
    [null, "preprod", false],
    ["mainnet", "preprod", false],
    ["preprod", "preprod", true],
  ] as const)("an event tagged %s counts on %s: %s", (tag, network, counts) => {
    expect(taskEventCountsOn(tag, network)).toBe(counts);
  });

  it("excludes an event whose Network tag was not selected", () => {
    // A missing select must fail credit assertions instead of counting Preprod receipts as Mainnet.
    // @ts-expect-error Simulate a reader that omitted network from its select.
    expect(taskEventCountsOn(undefined, "mainnet")).toBe(false);
  });

  function evaluateEventNetworkSql(
    alias: string,
    fragment: ReturnType<typeof taskEventCountsOnSql>,
    eventNetwork: string | null,
  ): boolean {
    if (
      fragment.text ===
      `(${alias}."network" IS NULL OR ${alias}."network" = $1)`
    ) {
      expect(fragment.values).toHaveLength(1);
      return eventNetwork === null || eventNetwork === fragment.values[0];
    }
    if (fragment.text === `${alias}."network" = $1`) {
      expect(fragment.values).toHaveLength(1);
      return eventNetwork === fragment.values[0];
    }
    throw new Error(`Unexpected SQL fragment: ${fragment.text}`);
  }

  it.each([
    [null, "mainnet"],
    ["mainnet", "mainnet"],
    ["preprod", "mainnet"],
    [null, "preprod"],
    ["mainnet", "preprod"],
    ["preprod", "preprod"],
  ] as const)(
    "agrees with taskEventCountsOnSql for event tag %s on %s",
    (tag, network) => {
      const fragment = taskEventCountsOnSql("e", network);
      expect(evaluateEventNetworkSql("e", fragment, tag)).toBe(
        taskEventCountsOn(tag, network),
      );
    },
  );

  it("renders the exact parameterized SQL fragment for any valid alias and rejects unsafe ones", () => {
    const mainnet = taskEventCountsOnSql("ev", "mainnet");
    expect(mainnet.text).toBe('(ev."network" IS NULL OR ev."network" = $1)');
    expect(mainnet.values).toEqual(["mainnet"]);

    const preprod = taskEventCountsOnSql("ev", "preprod");
    expect(preprod.text).toBe('ev."network" = $1');
    expect(preprod.values).toEqual(["preprod"]);

    expect(() => taskEventCountsOnSql('e" OR 1=1--', "mainnet")).toThrow(
      "Invalid taskEvent SQL alias",
    );
  });
});
