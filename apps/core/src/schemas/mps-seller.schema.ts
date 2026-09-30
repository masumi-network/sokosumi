import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

const identifier = z.string().min(1).max(250);

export const connectMpsSellerSchema = z
  .object({
    apiUrl: z
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }, "MPS endpoint must use HTTPS without credentials, query, or fragment"),
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (value) =>
          !/\s/u.test(value) && Buffer.byteLength(value, "utf8") <= 4096,
        "Invalid MPS API key",
      ),
    agentIdentifier: z
      .string()
      .min(57)
      .max(250)
      .regex(/^[0-9a-fA-F]+$/)
      .toLowerCase(),
    walletId: identifier,
    paymentSourceId: identifier,
  })
  .strict()
  .openapi("ConnectMpsSeller");

export const mpsSellerSchema = z
  .object({
    id: z.string(),
    coworkerId: z.string(),
    network: z.enum(["Preprod", "Mainnet"]),
    apiUrl: z.string(),
    agentIdentifier: z.string(),
    walletId: z.string(),
    paymentSourceId: z.string(),
    sellerVkey: z.string(),
    walletAddress: z.string(),
    sellerReturnAddress: z.string().nullable(),
    paymentSourceType: z.enum(["Web3CardanoV1", "Web3CardanoV2"]),
    smartContractAddress: z.string(),
    verifiedAt: dateTimeSchema,
    revokedAt: dateTimeSchema.nullable(),
    paymentsEnabled: z.literal(false),
  })
  .openapi("MpsSeller");

export const revokeMpsSellerSchema = z
  .object({ bindingId: z.string().min(1) })
  .strict();
