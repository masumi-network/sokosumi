import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import {
  refineChannelOriginConflict,
  resolveTaskEventChannel,
} from "@/helpers/task-event-channel";
import {
  taskEventChannelField,
  taskEventDeprecatedOriginField,
} from "@/schemas/task.schema";

const masumiPaymentAmountSchema = z.object({
  amount: z.string().min(1).openapi({ example: "470000000000" }),
  unit: z.string().min(1).openapi({
    example: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
  }),
});

const masumiPaymentSourceSchema = z
  .object({
    network: z.enum(["Preprod", "Mainnet"]).openapi({ example: "Preprod" }),
    smartContractAddress: z.string().min(1).openapi({
      example:
        "addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm",
    }),
    policyId: z.string().min(1).openapi({
      example: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
    }),
  })
  .openapi("MasumiTaskPaymentSource");

const masumiPaymentPayloadSchema = z
  .object({
    blockchainIdentifier: z.string().min(1).openapi({
      example: "0b00e04c0860a60c61066056281180462d0b12",
    }),
    identifierFromPurchaser: z.string().min(1).openapi({
      example: "1234567890",
    }),
    agentIdentifier: z.string().min(1).openapi({
      example: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
    }),
    sellerVkey: z.string().min(1).openapi({
      example: "0bde475ace6b116298363b268309fa62172f7208625a9a83eeaffdbd",
    }),
    submitResultTime: z.string().min(1).openapi({ example: "1775681853000" }),
    payByTime: z.string().min(1).openapi({ example: "1775737949000" }),
    unlockTime: z.string().min(1).openapi({ example: "1775763149000" }),
    externalDisputeUnlockTime: z
      .string()
      .min(1)
      .openapi({ example: "1775784749000" }),
    inputHash: z.string().min(1).openapi({
      example:
        "3b2d456a720bf5b3e2cc2cebaea9f9a937cd8b4d64267da3271bca937cb56af1",
    }),
    paymentSourceType: z.enum(["Web3CardanoV1", "Web3CardanoV2"]).optional(),
    supportedPaymentSourceIndex: z.number().int().min(0).max(24).optional(),
    Amounts: z.array(masumiPaymentAmountSchema).min(1).openapi({ example: [] }),
    PaymentSource: masumiPaymentSourceSchema.optional(),
  })
  .openapi("MasumiPayment");

export function createTaskEventRequestSchema(
  params: { serverNetwork: "Preprod" | "Mainnet" } = {
    serverNetwork: "Preprod",
  },
) {
  const { serverNetwork } = params;

  return z
    .object({
      status: z
        .enum(TaskStatus)
        .optional()
        .openapi({ example: TaskStatus.RUNNING }),
      comment: z
        .string()
        .optional()
        .openapi({ example: "Task Event is running" }),
      authenticationUrl: z
        .httpUrl()
        .optional()
        .openapi({ example: "https://example.com/oauth/authorize" }),
      credits: z.number().positive().nullish().openapi({
        example: 5,
        description:
          "Omit when masumiPayment is set; billing uses masumiPayment.Amounts instead.",
      }),
      channel: taskEventChannelField.optional(),
      origin: taskEventDeprecatedOriginField.optional(),
      masumiPayment: masumiPaymentPayloadSchema.optional().openapi({
        description:
          "On-chain Masumi credit charge for a credit-bearing task event. Coworker-only; allowed on any credit-bearing event; omit credits when set.",
      }),
    })
    .superRefine((data, ctx) => {
      refineChannelOriginConflict(data, ctx);

      if (
        data.status === undefined &&
        data.comment === undefined &&
        data.credits == null &&
        data.masumiPayment === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "At least one of status, comment, credits, or masumiPayment is required",
          path: ["status", "comment", "credits", "masumiPayment"],
        });
      }

      if (data.masumiPayment !== undefined) {
        if (data.credits !== undefined) {
          ctx.addIssue({
            code: "custom",
            message:
              "Do not send credits when masumiPayment is set; billing uses masumiPayment.Amounts instead.",
            path: ["credits"],
          });
        }

        const sourceNetwork = data.masumiPayment.PaymentSource?.network;
        if (sourceNetwork !== undefined && sourceNetwork !== serverNetwork) {
          ctx.addIssue({
            code: "custom",
            message: `PaymentSource.network must match server network (${serverNetwork})`,
            path: ["masumiPayment", "PaymentSource", "network"],
          });
        }

        // Fail fast pre-charge on payloads the payment node would reject
        // post-charge (the async purchase has no compensation path).
        if (
          data.masumiPayment.paymentSourceType === "Web3CardanoV1" &&
          data.masumiPayment.supportedPaymentSourceIndex !== undefined
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              "supportedPaymentSourceIndex is only valid for Web3CardanoV2 payments",
            path: ["masumiPayment", "supportedPaymentSourceIndex"],
          });
        }

        const paymentSource = data.masumiPayment.PaymentSource;
        if (paymentSource !== undefined) {
          const identifierPolicyId = data.masumiPayment.agentIdentifier.slice(
            0,
            56,
          );
          if (paymentSource.policyId !== identifierPolicyId) {
            ctx.addIssue({
              code: "custom",
              message:
                "PaymentSource.policyId must match the agentIdentifier's policy prefix",
              path: ["masumiPayment", "PaymentSource", "policyId"],
            });
          }
          const expectedAddressPrefix =
            serverNetwork === "Mainnet" ? "addr1" : "addr_test1";
          if (
            !paymentSource.smartContractAddress.startsWith(
              expectedAddressPrefix,
            )
          ) {
            ctx.addIssue({
              code: "custom",
              message: `PaymentSource.smartContractAddress must be a ${serverNetwork} bech32 address`,
              path: ["masumiPayment", "PaymentSource", "smartContractAddress"],
            });
          }
        }
      }

      if (
        data.credits != null &&
        data.credits < LIMITS.MIN_CHARGEABLE_CREDITS
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Credit amount is below the minimum chargeable value (${LIMITS.MIN_CHARGEABLE_CREDITS})`,
          path: ["credits"],
        });
      }

      if (data.status === TaskStatus.AUTHENTICATION_REQUIRED) {
        if (!data.authenticationUrl) {
          ctx.addIssue({
            code: "custom",
            message:
              "authenticationUrl is required for authentication requests",
            path: ["authenticationUrl"],
          });
        } else if (!data.authenticationUrl.startsWith("https://")) {
          ctx.addIssue({
            code: "custom",
            message: "authenticationUrl must be an https URL",
            path: ["authenticationUrl"],
          });
        }
      } else if (data.authenticationUrl !== undefined) {
        ctx.addIssue({
          code: "custom",
          message:
            "authenticationUrl is only allowed for authentication requests",
          path: ["authenticationUrl"],
        });
      }
    })
    .transform((data) => ({
      ...data,
      channel: resolveTaskEventChannel(data),
    }));
}
