import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRefusedNetworkScope,
  type NetworkScope,
  type SharedDb,
} from "@/lib/db/network-scope";

import {
  createTaskEventTransaction,
  isInsufficientBalanceError,
} from "./task-credits";

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    creditBucketRepository: {
      prepareConsumption: vi.fn(),
      recordSpend: vi.fn(),
    },
  };
});

const prepareConsumption = vi.mocked(creditBucketRepository.prepareConsumption);
const recordSpend = vi.mocked(creditBucketRepository.recordSpend);
// The charge hands both on untouched: it reads only the scope's Network.
const scope = { network: "preprod" } as NetworkScope;
const tx = {} as SharedDb;

describe("createTaskEventTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("consumes personal credits when organizationId is null", async () => {
    const consumptions = [{ bucketId: "bucket_1", amount: 100n }];
    prepareConsumption.mockResolvedValue(consumptions);
    recordSpend.mockResolvedValue("trx_1");

    const result = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: null,
      cents: 500n,
      scope,
      tx,
    });

    expect(result).toBe("trx_1");
    // No Project: the charge sees only the pool.
    expect(prepareConsumption).toHaveBeenCalledWith(
      "preprod",
      "user_1",
      null,
      500n,
      tx,
      { projectId: null },
    );
    expect(recordSpend).toHaveBeenCalledExactlyOnceWith(
      "preprod",
      { userId: "user_1", organizationId: null, cents: 500n, consumptions },
      tx,
    );
  });

  it("consumes organization credits when organizationId is set", async () => {
    const consumptions = [{ bucketId: "bucket_1", amount: 100n }];
    prepareConsumption.mockResolvedValue(consumptions);
    recordSpend.mockResolvedValue("trx_2");

    const result = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: "org_1",
      cents: 500n,
      scope,
      tx,
    });

    expect(result).toBe("trx_2");
    expect(prepareConsumption).toHaveBeenCalledWith(
      "preprod",
      "user_1",
      "org_1",
      500n,
      tx,
      { projectId: null },
    );
    expect(recordSpend).toHaveBeenCalledExactlyOnceWith(
      "preprod",
      { userId: "user_1", organizationId: "org_1", cents: 500n, consumptions },
      tx,
    );
  });

  it("reads and records an empty user or Organization id as none", async () => {
    // Changed with the move into the credits module (decided 2026-11-27): an
    // empty id is now none for the bucket choice too, not only for the debit,
    // because `spend` takes one payer for both. No user, Organization,
    // transaction or bucket has an empty id (measured on production), so only
    // an id no row has reads differently than on `origin/main`.
    const consumptions = [{ bucketId: "bucket_1", amount: 500n }];
    prepareConsumption.mockResolvedValue(consumptions);

    await createTaskEventTransaction({
      userId: "",
      organizationId: "",
      cents: 500n,
      scope,
      tx,
    });

    expect(prepareConsumption).toHaveBeenCalledExactlyOnceWith(
      "preprod",
      null,
      null,
      500n,
      tx,
      { projectId: null },
    );
    expect(recordSpend).toHaveBeenCalledExactlyOnceWith(
      "preprod",
      { userId: null, organizationId: null, cents: 500n, consumptions },
      tx,
    );
  });

  it("charges with the Project the work belongs to", async () => {
    prepareConsumption.mockResolvedValue([
      { bucketId: "bucket_1", amount: 500n },
    ]);

    await createTaskEventTransaction({
      userId: "user_1",
      organizationId: "org_1",
      projectId: "project_1",
      cents: 500n,
      scope,
      tx,
    });

    expect(prepareConsumption).toHaveBeenCalledWith(
      "preprod",
      "user_1",
      "org_1",
      500n,
      tx,
      { projectId: "project_1" },
    );
  });

  it("returns null when cents are zero", async () => {
    const result = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: null,
      cents: 0n,
      scope,
      tx,
    });

    expect(result).toBeNull();
    expect(prepareConsumption).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("throws when credits are insufficient", async () => {
    prepareConsumption.mockRejectedValue(
      new InsufficientBalanceError(500n, 200n),
    );

    await expect(
      createTaskEventTransaction({
        userId: "user_1",
        organizationId: null,
        cents: 500n,
        scope,
        tx,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message:
        "Insufficient balance: tried to consume 500 but only 200 available",
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    } satisfies Pick<HTTPException, "status" | "message" | "cause">);

    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("answers any other failure of the bucket choice with a plain 422", async () => {
    const failure = new Error("could not serialize access");
    prepareConsumption.mockRejectedValue(failure);

    const thrown = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: null,
      cents: 500n,
      scope,
      tx,
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(HTTPException);
    expect(thrown).toMatchObject({
      status: 422,
      message: "could not serialize access",
    });
    expect(isInsufficientBalanceError(thrown)).toBe(false);
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("answers a scope that refuses its Network with a plain 422", async () => {
    const refusing = createRefusedNetworkScope(
      new HTTPException(403, { message: "Preprod is switched off" }),
    );

    await expect(
      createTaskEventTransaction({
        userId: "user_1",
        organizationId: null,
        cents: 500n,
        scope: refusing,
        tx,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Preprod is switched off",
    });
    expect(prepareConsumption).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("passes a value thrown by the bucket choice that is no Error", async () => {
    prepareConsumption.mockRejectedValue("not an error");

    await expect(
      createTaskEventTransaction({
        userId: "user_1",
        organizationId: null,
        cents: 500n,
        scope,
        tx,
      }),
    ).rejects.toBe("not an error");
  });

  it("passes a failed write as it is", async () => {
    prepareConsumption.mockResolvedValue([
      { bucketId: "bucket_1", amount: 500n },
    ]);
    const failure = new Error("write failed");
    recordSpend.mockRejectedValue(failure);

    await expect(
      createTaskEventTransaction({
        userId: "user_1",
        organizationId: null,
        cents: 500n,
        scope,
        tx,
      }),
    ).rejects.toBe(failure);
  });

  it("detects insufficient-balance errors by kind", () => {
    expect(
      isInsufficientBalanceError(
        new HTTPException(422, {
          message: "Insufficient balance",
          cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
        }),
      ),
    ).toBe(true);

    expect(
      isInsufficientBalanceError(
        new HTTPException(422, { message: "Insufficient balance" }),
      ),
    ).toBe(false);

    expect(
      isInsufficientBalanceError(
        new HTTPException(422, {
          message: "Other error",
          cause: { kind: "other" },
        }),
      ),
    ).toBe(false);
  });
});
