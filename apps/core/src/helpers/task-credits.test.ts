import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";

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
