import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Channel, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { LIMITS } from "@/config/constants";
import { taskEventSchema } from "@/schemas/task.schema";

import { createTaskEventRequestSchema } from "./schema";

const taskEventRequestSchema = createTaskEventRequestSchema();

const validMasumiPayment = {
  blockchainIdentifier: "0b00e04c0860a60c61066056281180462d0b12",
  identifierFromPurchaser: "aabbccddeeff00112233",
  agentIdentifier: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
  sellerVkey: "0bde475ace6b116298363b268309fa62172f7208625a9a83eeaffdbd",
  submitResultTime: "1775681853000",
  payByTime: "1775737949000",
  unlockTime: "1775763149000",
  externalDisputeUnlockTime: "1775784749000",
  inputHash: "3b2d456a720bf5b3e2cc2cebaea9f9a937cd8b4d64267da3271bca937cb56af1",
  Amounts: [
    {
      amount: "470000000000",
      unit: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
    },
  ],
} as const;

const V2_POLICY_ID = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";

describe("createTaskEventRequestSchema", () => {
  it("tolerates a payment-source index on a V1 masumiPayment", () => {
    // Sellers upgrading their SDK emit V2-shaped fields on V1 responses;
    // rejecting here would break those agents mid-rollout, so the payload is
    // accepted and the field ignored downstream (mirrors the job flow).
    const result = createTaskEventRequestSchema().safeParse({
      status: TaskStatus.COMPLETED,
      masumiPayment: {
        ...validMasumiPayment,
        paymentSourceType: "Web3CardanoV1",
        supportedPaymentSourceIndex: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a malformed identifier under the V2 registry policy", () => {
    const schema = createTaskEventRequestSchema({ serverNetwork: "Preprod" });
    const result = schema.safeParse({
      status: "COMPLETED",
      masumiPayment: {
        ...validMasumiPayment,
        agentIdentifier: `${V2_POLICY_ID}abcd`,
        PaymentSource: {
          network: "Preprod",
          smartContractAddress:
            "addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm",
          policyId: V2_POLICY_ID,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a PaymentSource whose policyId mismatches the agent identifier", () => {
    const schema = createTaskEventRequestSchema({ serverNetwork: "Preprod" });
    const result = schema.safeParse({
      status: "COMPLETED",
      masumiPayment: {
        ...validMasumiPayment,
        // PaymentSource rules are asserted for V2 payloads only.
        paymentSourceType: "Web3CardanoV2",
        PaymentSource: {
          network: "Preprod",
          smartContractAddress:
            "addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm",
          policyId: "ff".repeat(28),
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a smart contract address with the wrong network prefix", () => {
    const schema = createTaskEventRequestSchema({ serverNetwork: "Preprod" });
    const result = schema.safeParse({
      status: "COMPLETED",
      masumiPayment: {
        ...validMasumiPayment,
        paymentSourceType: "Web3CardanoV2",
        PaymentSource: {
          network: "Preprod",
          smartContractAddress:
            "addr1wxs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgge2j6d",
          policyId: validMasumiPayment.agentIdentifier.slice(0, 56),
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("leaves a V1 payload's PaymentSource unvalidated", () => {
    // PaymentSource predates the V2 rules on this public API; V1 callers may
    // populate it with their own tuple and must not be rejected for it.
    const schema = createTaskEventRequestSchema({ serverNetwork: "Preprod" });
    const result = schema.safeParse({
      status: "COMPLETED",
      masumiPayment: {
        ...validMasumiPayment,
        PaymentSource: {
          network: "Preprod",
          smartContractAddress: "addr_test1_v1_escrow_contract",
          policyId: "ff".repeat(28),
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a V1 rail declared on a V2 registry identifier", () => {
    // The node infers V2 from the identifier and 400s the mismatch. Task
    // charges commit before the purchase, so this must fail pre-charge.
    const schema = createTaskEventRequestSchema({ serverNetwork: "Preprod" });
    const result = schema.safeParse({
      status: "COMPLETED",
      masumiPayment: {
        ...validMasumiPayment,
        agentIdentifier: `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b${"ab".repeat(29)}000001`,
        paymentSourceType: "Web3CardanoV1",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid channel", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      channel: Channel.SLACK,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(Channel.SLACK);
    }
  });

  it("accepts deprecated origin as channel", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      origin: Channel.SLACK,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(Channel.SLACK);
      expect(result.data.origin).toBe(Channel.SLACK);
    }
  });

  it("accepts DISCORD channel", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      channel: Channel.DISCORD,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(Channel.DISCORD);
    }
  });

  it("accepts MESSENGER channel", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      channel: Channel.MESSENGER,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(Channel.MESSENGER);
    }
  });

  it("accepts matching channel and origin", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      channel: Channel.TEAMS,
      origin: Channel.TEAMS,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(Channel.TEAMS);
    }
  });

  it("rejects conflicting channel and origin", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      channel: Channel.SLACK,
      origin: Channel.EMAIL,
    });

    expect(result.success).toBe(false);
  });

  it("throws an error for unsupported channels", () => {
    expect(() => {
      taskEventRequestSchema.parse({
        status: TaskStatus.RUNNING,
        channel: "Discord",
      });
    }).toThrow();
  });

  it("throws an error for null channel", () => {
    expect(() => {
      taskEventRequestSchema.parse({
        status: TaskStatus.RUNNING,
        channel: null,
      });
    }).toThrow();
  });

  it("defaults missing channel and origin to SOKOSUMI", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(Channel.SOKOSUMI);
    }
  });

  it("marks TaskEvent.origin as deprecated in OpenAPI", () => {
    const app = new OpenAPIHono();
    app.openapi(
      createRoute({
        method: "get",
        path: "/probe",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: taskEventSchema,
              },
            },
            description: "probe",
          },
        },
      }),
      () => {
        throw new Error("unreachable");
      },
    );

    const doc = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "1" },
    });

    expect(doc.components?.schemas?.TaskEvent).toMatchObject({
      properties: {
        origin: {
          allOf: [
            { $ref: "#/components/schemas/Channel" },
            {
              deprecated: true,
              description: "Deprecated. Use channel instead.",
            },
          ],
        },
        channel: {
          $ref: "#/components/schemas/Channel",
        },
      },
    });
    expect(doc.components?.schemas?.Channel).toMatchObject({
      type: "string",
    });
  });

  it("accepts authentication required with https url", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
      authenticationUrl: "https://example.com/oauth/authorize",
    });

    expect(result.success).toBe(true);
  });

  it("rejects authentication required without auth url", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-https auth url", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
      authenticationUrl: "http://example.com/oauth/authorize",
    });

    expect(result.success).toBe(false);
  });

  it("rejects auth url for non-auth status", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      authenticationUrl: "https://example.com/oauth/authorize",
    });

    expect(result.success).toBe(false);
  });

  it("rejects auth url for comment-only events", () => {
    const result = taskEventRequestSchema.safeParse({
      comment: "Needs attention",
      authenticationUrl: "https://example.com/oauth/authorize",
    });

    expect(result.success).toBe(false);
  });

  it("accepts credits for canceled tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.CANCELED,
      credits: 3,
    });

    expect(result.success).toBe(true);
  });

  it("accepts credits-only body", () => {
    const result = taskEventRequestSchema.safeParse({
      credits: 3,
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty body", () => {
    const result = taskEventRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it("accepts credits for running tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      credits: 3,
    });

    expect(result.success).toBe(true);
  });

  it("accepts credits for comment-only requests", () => {
    const result = taskEventRequestSchema.safeParse({
      comment: "hello",
      credits: 5,
    });

    expect(result.success).toBe(true);
  });

  it("accepts out-of-credits tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.OUT_OF_CREDITS,
    });

    expect(result.success).toBe(true);
  });

  it("accepts completed tasks without credits", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
    });

    expect(result.success).toBe(true);
  });

  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELED])(
    "accepts fractional credits for %s tasks",
    (status) => {
      const result = taskEventRequestSchema.safeParse({
        status,
        credits: 0.25,
      });

      expect(result.success).toBe(true);
    },
  );

  it("accepts null credits for completed tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects zero credits for completed tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: 0,
    });

    expect(result.success).toBe(false);
  });

  it("accepts null credits for non-terminal statuses", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.INPUT_REQUIRED,
      credits: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts credits for input-required tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.INPUT_REQUIRED,
      credits: 2,
    });

    expect(result.success).toBe(true);
  });

  it("accepts credits for credits-topped-up tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.CREDITS_TOPPED_UP,
      credits: 2,
    });

    expect(result.success).toBe(true);
  });

  it("rejects credits below minimum regardless of status", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      credits: LIMITS.MIN_CHARGEABLE_CREDITS / 10,
    });

    expect(result.success).toBe(false);
  });

  it("rejects credits below minimum for completed tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: LIMITS.MIN_CHARGEABLE_CREDITS / 10,
    });

    expect(result.success).toBe(false);
  });

  it("rejects credits below minimum for canceled tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.CANCELED,
      credits: 1e-11,
    });

    expect(result.success).toBe(false);
  });

  it("accepts credits at minimum for completed tasks", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: LIMITS.MIN_CHARGEABLE_CREDITS,
    });

    expect(result.success).toBe(true);
  });

  it("accepts COMPLETED with masumiPayment and optional PaymentSource", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      masumiPayment: {
        ...validMasumiPayment,
        PaymentSource: {
          network: "Preprod",
          smartContractAddress:
            "addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm",
          policyId: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a V2 masumiPayment with its source index", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      masumiPayment: {
        ...validMasumiPayment,
        paymentSourceType: "Web3CardanoV2",
        supportedPaymentSourceIndex: 2,
      },
    });

    expect(result.success).toBe(true);
  });

  it("keeps legacy V2 masumiPayment payloads without a source index compatible", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      masumiPayment: {
        ...validMasumiPayment,
        paymentSourceType: "Web3CardanoV2",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a bare source index on a V1-policy payload", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      masumiPayment: {
        ...validMasumiPayment,
        supportedPaymentSourceIndex: 2,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects masumiPayment with credits", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: 5,
      masumiPayment: validMasumiPayment,
    });

    expect(result.success).toBe(false);
  });

  it("rejects masumiPayment with explicit null credits", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: null,
      masumiPayment: validMasumiPayment,
    });

    expect(result.success).toBe(false);
  });

  it("accepts masumiPayment when status is RUNNING", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      masumiPayment: validMasumiPayment,
    });

    expect(result.success).toBe(true);
  });

  it("accepts masumiPayment when status is CANCELED", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.CANCELED,
      masumiPayment: validMasumiPayment,
    });

    expect(result.success).toBe(true);
  });

  it("accepts charge-only masumiPayment without status, comment, or credits", () => {
    const result = taskEventRequestSchema.safeParse({
      masumiPayment: validMasumiPayment,
    });

    expect(result.success).toBe(true);
  });

  it("rejects PaymentSource.network mismatch", () => {
    const schema = createTaskEventRequestSchema({ serverNetwork: "Preprod" });
    const result = schema.safeParse({
      status: TaskStatus.COMPLETED,
      masumiPayment: {
        ...validMasumiPayment,
        PaymentSource: {
          network: "Mainnet",
          smartContractAddress: "addr1",
          policyId: "pol1",
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
