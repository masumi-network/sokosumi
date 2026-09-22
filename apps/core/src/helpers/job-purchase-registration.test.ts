import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED_SECRET } from "@/lib/secret-redaction";
import {
  PURCHASE_REGISTRATION_ATTEMPTS,
  registerJobPurchase,
} from "./job-purchase-registration";

const {
  createJobPurchaseMock,
  createPurchaseMock,
  sentryCaptureExceptionMock,
  transformPurchaseToJobUpdateMock,
} = vi.hoisted(() => ({
  createJobPurchaseMock: vi.fn(),
  createPurchaseMock: vi.fn(),
  sentryCaptureExceptionMock: vi.fn(),
  transformPurchaseToJobUpdateMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: sentryCaptureExceptionMock,
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    createPurchase: createPurchaseMock,
  }),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobPurchaseRepository: {
    createJobPurchase: createJobPurchaseMock,
  },
}));

vi.mock("@/helpers/purchase", () => ({
  transformPurchaseToJobUpdate: transformPurchaseToJobUpdateMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

const params = {
  jobId: "job_1",
  agentId: "agent_1",
  agentBlockchainIdentifier: "agent-chain-id",
  startJobResponse: { id: "agent_job_1" },
  inputData: { prompt: "hello" },
  identifierFromPurchaser: "purchaser-id",
  amounts: [{ amount: "1000000", unit: "" }],
} as unknown as Parameters<typeof registerJobPurchase>[0];

function createSleepSpy() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transformPurchaseToJobUpdateMock.mockReturnValue({
    blockchainIdentifier: "chain-id",
  });
  createJobPurchaseMock.mockResolvedValue({ id: "purchase_1" });
});

/**
 * Assigned at module scope, because `getEnvSecrets` scans `process.env` once
 * and caches the result. A variable set inside a test body would arrive after
 * the first redacted log had already populated that cache.
 */
const ENV_SECRET = "sok1011-purchase-secret-value";
process.env.SOK_1011_PAYMENT_API_KEY = ENV_SECRET;

describe("registerJobPurchase", () => {
  it("stores the purchase the node returns", async () => {
    createPurchaseMock.mockResolvedValue(ok({ id: "node-purchase" }));
    const { sleep, delays } = createSleepSpy();

    await registerJobPurchase(params, { sleep });

    expect(createPurchaseMock).toHaveBeenCalledTimes(1);
    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain-id",
      params.startJobResponse,
      params.inputData,
      "purchaser-id",
      params.amounts,
    );
    expect(createJobPurchaseMock).toHaveBeenCalledWith(
      { jobId: "job_1", blockchainIdentifier: "chain-id" },
      {},
    );
    expect(delays).toEqual([]);
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("retries an ambiguous failure and stays silent once it succeeds", async () => {
    // The node answers a repeat post with 409 and the client resolves the
    // existing purchase, so retrying converges on one row. A single dropped
    // connection must not cost the user the hire, and must not page either.
    createPurchaseMock
      .mockResolvedValueOnce(
        err({ kind: "ambiguous", message: "socket hang up" }),
      )
      .mockResolvedValueOnce(ok({ id: "node-purchase" }));
    const { sleep, delays } = createSleepSpy();

    await registerJobPurchase(params, { sleep });

    expect(createPurchaseMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([250]);
    expect(createJobPurchaseMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("masks an env secret the node echoed back in its failure message", async () => {
    // A gateway answering for the payment node can echo the request headers,
    // and `extractNodeErrorMessage` dumps that body into `message`.
    createPurchaseMock.mockResolvedValue(
      err({
        kind: "permanent",
        message: `400 {"sent":{"token":"${ENV_SECRET}"}}`,
        status: 400,
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await registerJobPurchase(params, { sleep: createSleepSpy().sleep });

      const logged = warnSpy.mock.calls.find(
        (call) =>
          call[0] === "[registerJobPurchase] purchase registration failed",
      );
      expect(logged).toBeDefined();
      const payload = logged?.[1] as { error: string };
      expect(payload.error).not.toContain(ENV_SECRET);
      expect(payload.error).toContain(REDACTED_SECRET);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not retry a permanent rejection", async () => {
    // A permanent rejection is the node refusing this exact payload, so every
    // retry would be refused identically.
    createPurchaseMock.mockResolvedValue(
      err({ kind: "permanent", message: "amount mismatch", status: 400 }),
    );
    const { sleep, delays } = createSleepSpy();

    await registerJobPurchase(params, { sleep });

    expect(createPurchaseMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("likely price drift"),
    });
  });

  it("pages once the whole retry budget is spent", async () => {
    // Nothing downstream posts this purchase later: job sync can adopt a
    // purchase the node already holds, but it never creates one. An exhausted
    // budget is an outage, not a blip, so it has to be visible.
    createPurchaseMock.mockResolvedValue(
      err({ kind: "ambiguous", message: "502 Bad Gateway" }),
    );
    const { sleep, delays } = createSleepSpy();

    await registerJobPurchase(params, { sleep });

    expect(createPurchaseMock).toHaveBeenCalledTimes(
      PURCHASE_REGISTRATION_ATTEMPTS,
    );
    expect(delays).toEqual([250, 1000]);
    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("after 3 attempts"),
    });
  });

  it("reports a failed local write without losing the registered purchase", async () => {
    createPurchaseMock.mockResolvedValue(ok({ id: "node-purchase" }));
    createJobPurchaseMock.mockRejectedValue(new Error("unique violation"));
    const { sleep } = createSleepSpy();

    await registerJobPurchase(params, { sleep });

    expect(createPurchaseMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: "unique violation",
    });
  });
});
