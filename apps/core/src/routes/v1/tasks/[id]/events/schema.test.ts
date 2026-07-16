import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Channel } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
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

describe("createTaskEventRequestSchema", () => {
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

  it("rejects masumiPayment when status is CANCELED", () => {
    const result = taskEventRequestSchema.safeParse({
      status: TaskStatus.CANCELED,
      masumiPayment: validMasumiPayment,
    });

    expect(result.success).toBe(false);
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
