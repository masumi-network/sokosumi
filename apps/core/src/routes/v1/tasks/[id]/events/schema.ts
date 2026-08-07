import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  parseVersionedAgentIdentifier,
} from "@sokosumi/masumi";

import { LIMITS } from "@/config/constants";
import {
  hasContradictoryMasumiTaskPaymentRail,
  isV2MasumiTaskPayment,
} from "@/helpers/masumi-task-payment";
import {
  refineChannelOriginConflict,
  resolveTaskEventChannel,
} from "@/helpers/task-event-channel";
import {
  taskEventChannelField,
  taskEventDeprecatedOriginField,
} from "@/schemas/task.schema";

// Case-insensitive via an explicit character class, NOT the `i` flag:
// zod-openapi serialises a flagged RegExp into the JSON-Schema `pattern` with
// the flag still attached (`^[0-9a-f]+$/i`), which no value can satisfy — every
// consumer validating against the published contract would reject valid hex.
const HEX_PATTERN = /^[0-9a-fA-F]+$/;
const MASUMI_TIMESTAMP_PATTERN = /^\d{1,19}$/;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

const masumiTimestampSchema = z
  .string()
  .regex(MASUMI_TIMESTAMP_PATTERN, "must be a positive millisecond timestamp")
  .refine(
    (value) => MASUMI_TIMESTAMP_PATTERN.test(value) && BigInt(value) > 0n,
    "must be a positive millisecond timestamp",
  )
  .refine(
    (value) =>
      MASUMI_TIMESTAMP_PATTERN.test(value) && BigInt(value) <= MAX_SIGNED_INT64,
    "must fit in a signed 64-bit integer",
  )
  // Canonicalize, like the hex fields above are lowercased. The node stores
  // these as numbers and echoes the canonical form back, so "0177…" would be
  // stored and sent by us but returned as "177…" — and purchase
  // reconciliation treats a term it cannot match as a `mismatch`, which
  // refunds the buyer while the on-chain purchase stays live.
  .transform((value) => BigInt(value).toString());

const masumiPaymentAmountSchema = z.object({
  // The node caps amount strings at 25 characters — mirror it pre-charge.
  amount: z
    .string()
    .min(1)
    .max(25)
    .regex(/^\d+$/, "amount must be an unsigned integer")
    .refine(
      (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
      "amount must be positive",
    )
    .openapi({ example: "470000000000" }),
  // Payment node represents ADA/lovelace with an empty unit.
  unit: z.string().max(150).openapi({
    example: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
  }),
});

const masumiPaymentSourceSchema = z
  .object({
    network: z.enum(["Preprod", "Mainnet"]).openapi({ example: "Preprod" }),
    smartContractAddress: z.string().min(1).max(250).toLowerCase().openapi({
      example:
        "addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm",
    }),
    policyId: z.string().length(56).regex(HEX_PATTERN).toLowerCase().openapi({
      example: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
    }),
  })
  .openapi("MasumiTaskPaymentSource");

const masumiPaymentPayloadSchema = z
  .object({
    // Matches POST /purchase exactly: `type: string, maxLength: 8000`, with
    // no pattern. The node does NOT define this as hex, and it is the seller's
    // own value — validating a format it never promised would reject legal
    // payloads, and normalizing the casing would hand the node something the
    // seller did not send. The duplicate-payment guard still compares
    // case-insensitively; it lowercases the claim's unique key at the call
    // site rather than rewriting the value forwarded to the node.
    blockchainIdentifier: z.string().min(1).max(8000).openapi({
      example: "0b00e04c0860a60c61066056281180462d0b12",
    }),
    // Mirrors the payment node's request limits (min 14 / max 26, hex with an
    // even number of digits — it must decode to whole bytes) so a payload the
    // node deterministically rejects fails BEFORE the charge.
    identifierFromPurchaser: z
      .string()
      .min(14)
      .max(26)
      .regex(HEX_PATTERN, "identifierFromPurchaser must be hex")
      .refine(
        (value) => value.length % 2 === 0,
        "identifierFromPurchaser must be even-length hex",
      )
      .openapi({
        example: "aabbccddeeff00112233",
      }),
    agentIdentifier: z
      .string()
      .min(1)
      .max(250)
      .regex(HEX_PATTERN, "agentIdentifier must be hex")
      .toLowerCase()
      .openapi({
        example: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
      }),
    sellerVkey: z
      .string()
      .length(56)
      .regex(HEX_PATTERN, "sellerVkey must be 56 hex characters")
      .toLowerCase()
      .openapi({
        example: "0bde475ace6b116298363b268309fa62172f7208625a9a83eeaffdbd",
      }),
    submitResultTime: masumiTimestampSchema.openapi({
      example: "1775681853000",
    }),
    payByTime: masumiTimestampSchema.openapi({ example: "1775737949000" }),
    unlockTime: masumiTimestampSchema.openapi({ example: "1775763149000" }),
    externalDisputeUnlockTime: masumiTimestampSchema.openapi({
      example: "1775784749000",
    }),
    inputHash: z
      .string()
      .length(64)
      .regex(HEX_PATTERN, "inputHash must be a SHA-256 hex digest")
      .toLowerCase()
      .openapi({
        example:
          "3b2d456a720bf5b3e2cc2cebaea9f9a937cd8b4d64267da3271bca937cb56af1",
      }),
    paymentSourceType: z.enum(["Web3CardanoV1", "Web3CardanoV2"]).optional(),
    supportedPaymentSourceIndex: z.number().int().min(0).max(24).optional(),
    // The node caps Amounts at 7 entries — fail before the charge, not after.
    Amounts: z
      .array(masumiPaymentAmountSchema)
      .min(1)
      .max(7)
      .openapi({ example: [{ amount: "470000000000", unit: "" }] }),
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

        if (
          isV2RegistryIdentifier(data.masumiPayment.agentIdentifier) &&
          parseVersionedAgentIdentifier(data.masumiPayment.agentIdentifier) ===
            undefined
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              "V2 registry agentIdentifier must include a valid stable identity and version",
            path: ["masumiPayment", "agentIdentifier"],
          });
        }

        // A declared V1 rail on a V2-policy identifier is a contradiction the
        // payment node rejects with a 400. Fail before charging instead of
        // relying on asynchronous compensation for known-invalid input.
        if (hasContradictoryMasumiTaskPaymentRail(data.masumiPayment)) {
          ctx.addIssue({
            code: "custom",
            message:
              "paymentSourceType Web3CardanoV1 contradicts a V2 registry agentIdentifier",
            path: ["masumiPayment", "paymentSourceType"],
          });
        }

        // These have no V1 equivalent at the payment node, and PaymentSource
        // is a pre-existing optional field V1 callers may already populate —
        // so they are asserted only for payloads that are actually V2.
        const paymentSource = data.masumiPayment.PaymentSource;
        if (
          paymentSource !== undefined &&
          isV2MasumiTaskPayment(data.masumiPayment)
        ) {
          // Case-insensitive: hex casing must never decide validity (the V2
          // classifier and readiness checks normalize the same way).
          const identifierPolicyId = data.masumiPayment.agentIdentifier
            .slice(0, 56)
            .toLowerCase();
          if (paymentSource.policyId.toLowerCase() !== identifierPolicyId) {
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
