import { bech32 } from "@scure/base";
import { ssrfSafeFetch } from "@sokosumi/net";
import LZString from "lz-string";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import {
  aggregateMasumiPaymentAmounts,
  doMasumiPaymentAmountsMatch,
} from "../utils/payment-amounts.js";
import { createClient as createPaymentApiClient } from "./openapi/generated/payment/client/index.js";
import {
  getApiKeyStatus,
  getBalance,
  getPayment,
  getPaymentSource,
  getRegistryAgentIdentifier,
  getWalletList,
  postPayment,
} from "./openapi/generated/payment/index.js";
import { createClient as createRegistryApiClient } from "./openapi/generated/registry/client/index.js";
import { getPaymentInformation } from "./openapi/generated/registry/index.js";

const DEADLINE_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const ERROR_MESSAGES = {
  invalid_configuration: "Seller verification configuration is invalid",
  permission_denied:
    "Seller verification requires an active scoped read and pay key",
  identity_mismatch: "Seller identity or payment source could not be verified",
  invalid_response: "Seller verification received an invalid response",
  unsupported_pricing:
    "Seller verification requires matching fixed Cardano pricing",
  verification_unavailable: "Seller verification could not be completed",
  timeout: "Seller verification timed out",
} as const;

export interface MpsSellerVerificationError {
  code: keyof typeof ERROR_MESSAGES;
  message: string;
}

export interface MpsSellerNode {
  apiUrl: string;
  apiKey: string;
}

export interface VerifiedMpsSeller {
  apiUrl: string;
  apiKeyId: string;
  network: "Preprod" | "Mainnet";
  agentIdentifier: string;
  walletId: string;
  paymentSourceId: string;
  paymentSourceType: "Web3CardanoV1" | "Web3CardanoV2";
  policyId: string;
  smartContractAddress: string;
  sellerVkey: string;
  walletAddress: string;
  collectionAddress: string | null;
  amounts: Array<{ unit: string; amount: string }>;
  supportedPaymentSourceIndex?: number;
}

export interface SellerQuoteInput {
  agentIdentifier: string;
  walletId: string;
  paymentSourceId: string;
  sellerVkey: string;
  inputHash: string;
  identifierFromPurchaser: string;
  metadata: string;
  sellerReturnAddress: string | null;
  paymentSourceType: "Web3CardanoV1" | "Web3CardanoV2";
  smartContractAddress: string;
  supportedPaymentSourceIndex?: number;
  amounts: Array<{ unit: string; amount: string }>;
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
}

export interface SellerQuote {
  paymentId: string;
  blockchainIdentifier: string;
  agentIdentifier: string;
  sellerVkey: string;
  inputHash: string;
  identifierFromPurchaser: string;
  Amounts: Array<{ unit: string; amount: string }>;
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
  paymentSourceType: "Web3CardanoV1" | "Web3CardanoV2";
  smartContractAddress: string;
  sellerReturnAddress: string | null;
  supportedPaymentSourceIndex?: number;
}

const QUOTE_ERRORS = {
  ambiguous: "The seller quote outcome could not be verified",
  rejected: "The seller quote request was rejected",
  not_found: "No matching seller quote was found; creation must not be retried",
} as const;

export interface SellerQuoteError {
  kind: keyof typeof QUOTE_ERRORS;
  message: string;
}

const networkSchema = z.enum(["Preprod", "Mainnet"]);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,250}$/);
const hashSchema = z
  .string()
  .regex(/^[0-9a-f]{56}$/i)
  .toLowerCase();
const agentIdentifierSchema = z
  .string()
  .regex(/^[0-9a-f]{56}(?:[0-9a-f]{2}){1,32}$/i)
  .toLowerCase();
const addressSchema = z.string().min(1).max(150);
const sourceTypeSchema = z.enum(["Web3CardanoV1", "Web3CardanoV2"]);
const apiKeySchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/);
const nodeSchema = z.object({
  apiUrl: z.string().max(2048),
  apiKey: apiKeySchema,
});
const keySchema = z.object({
  id: idSchema,
  status: z.enum(["Active", "Revoked"]),
  canRead: z.boolean(),
  canPay: z.boolean(),
  canAdmin: z.boolean(),
  NetworkLimit: z.array(networkSchema).max(2),
  walletScopeEnabled: z.boolean(),
  WalletScopes: z.array(z.object({ hotWalletId: idSchema })).max(1000),
});
const walletSchema = z.object({
  id: idSchema,
  paymentSourceId: idSchema,
  type: z.enum(["Selling", "Purchasing", "Funding"]),
  walletVkey: hashSchema,
  walletAddress: addressSchema,
  collectionAddress: addressSchema.nullable(),
});
const sourceSchema = z.object({
  id: idSchema,
  network: networkSchema,
  paymentSourceType: sourceTypeSchema,
  policyId: hashSchema.nullable(),
  smartContractAddress: addressSchema,
});
const unitSchema = z
  .string()
  .max(120)
  .refine(
    (value) =>
      value === "" ||
      value.toLowerCase() === "lovelace" ||
      /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/i.test(value),
  );
const amountSchema = z.string().max(25).regex(/^\d+$/);
const fixedPricingSchema = z.object({
  pricingType: z.literal("Fixed"),
  fixed: z
    .array(z.object({ asset: unitSchema, amount: amountSchema }))
    .min(1)
    .max(7),
});
const advertisedSourceSchema = z.object({
  chain: z.literal("Cardano"),
  network: networkSchema,
  paymentSourceType: sourceTypeSchema,
  address: addressSchema,
  pricing: fixedPricingSchema,
});
const registrySchema = z.object({
  agentIdentifier: agentIdentifierSchema,
  paymentType: sourceTypeSchema,
  status: z.enum(["Online", "Offline", "Deregistered", "Invalid"]),
  RegistrySource: z.object({ policyId: hashSchema.nullable() }),
  sellerWallet: z.object({ address: addressSchema, vkey: hashSchema }),
  AgentPricing: z.unknown(),
  SupportedPaymentSources: z.array(z.unknown()).max(25),
});
const metadataSchema = z.object({
  agentIdentifier: agentIdentifierSchema,
  policyId: hashSchema,
  assetName: z
    .string()
    .regex(/^(?:[0-9a-f]{2}){1,32}$/i)
    .toLowerCase(),
  Metadata: z.object({
    metadataVersion: z.union([z.literal(1), z.literal(2)]),
    AgentPricing: z.unknown(),
    supportedPaymentSources: z.array(z.unknown()).max(25).nullable(),
  }),
});
const timestampSchema = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine(
    (value) =>
      Number.isSafeInteger(Number(value)) &&
      Number(value) <= 8_640_000_000_000_000,
  );
const quoteAmountsSchema = z
  .array(z.object({ unit: unitSchema, amount: amountSchema }))
  .min(1)
  .max(7);
const quoteTimesSchema = z.object({
  payByTime: timestampSchema,
  submitResultTime: timestampSchema,
  unlockTime: timestampSchema,
  externalDisputeUnlockTime: timestampSchema,
});
const quoteInputSchema = quoteTimesSchema.extend({
  agentIdentifier: agentIdentifierSchema,
  walletId: idSchema,
  paymentSourceId: idSchema,
  sellerVkey: hashSchema,
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  identifierFromPurchaser: z.string().regex(/^(?:[0-9a-f]{2}){7,13}$/),
  metadata: z.string().min(1).max(512),
  sellerReturnAddress: addressSchema.nullable(),
  paymentSourceType: sourceTypeSchema,
  smartContractAddress: addressSchema,
  supportedPaymentSourceIndex: z.number().int().min(0).max(24).optional(),
  amounts: quoteAmountsSchema,
});
const quoteResponseSchema = quoteTimesSchema.extend({
  id: idSchema,
  blockchainIdentifier: z
    .string()
    .max(2048)
    .regex(/^(?:[0-9a-f]{4})+$/),
  agentIdentifier: agentIdentifierSchema,
  pricingType: z.literal("Fixed"),
  requestedById: idSchema,
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  metadata: z.string().max(512),
  sellerReturnAddress: addressSchema.nullable(),
  forceLayer: z.null(),
  PaymentSource: sourceSchema,
  SmartContractWallet: z.object({
    id: idSchema,
    walletVkey: hashSchema,
    walletAddress: addressSchema,
  }),
  RequestedFunds: quoteAmountsSchema,
});

function boundedFetch(
  controller: AbortController,
  allowPost = false,
): typeof globalThis.fetch {
  let receivedBytes = 0;
  return async (url, init) => {
    const request = new Request(url, init);
    if (request.method !== "GET" && !(allowPost && request.method === "POST"))
      throw new VerificationFailure("invalid_configuration");
    controller.signal.throwIfAborted();
    return ssrfSafeFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ...(request.method === "POST" ? { body: await request.text() } : {}),
      signal: controller.signal,
      redirect: "error",
      maxResponseBytes: MAX_RESPONSE_BYTES,
      onResponseBytes(bytes) {
        receivedBytes += bytes;
        if (receivedBytes > MAX_TOTAL_BYTES)
          throw new VerificationFailure("verification_unavailable");
      },
    });
  };
}

function quoteError(kind: SellerQuoteError["kind"]): SellerQuoteError {
  return { kind, message: QUOTE_ERRORS[kind] };
}

function validateQuoteTimes(input: z.infer<typeof quoteTimesSchema>): void {
  requireMatch(
    Number(input.submitResultTime) - Number(input.payByTime) >= 5 * 60_000,
  );
  requireMatch(
    Number(input.unlockTime) - Number(input.submitResultTime) >= 15 * 60_000,
  );
  requireMatch(
    Number(input.externalDisputeUnlockTime) - Number(input.unlockTime) >=
      15 * 60_000,
  );
}

function validateQuote(
  value: unknown,
  input: SellerQuoteInput,
  seller: VerifiedMpsSeller,
  secrets: string[],
): SellerQuote {
  const row = parse(quoteResponseSchema, value);
  requireMatch(
    row.agentIdentifier === input.agentIdentifier &&
      row.inputHash === input.inputHash &&
      row.metadata === input.metadata,
  );
  requireMatch(
    row.requestedById === seller.apiKeyId &&
      row.sellerReturnAddress === input.sellerReturnAddress,
  );
  requireMatch(
    row.SmartContractWallet.id === seller.walletId &&
      row.SmartContractWallet.walletVkey === seller.sellerVkey &&
      row.SmartContractWallet.walletAddress === seller.walletAddress,
  );
  requireMatch(
    row.PaymentSource.id === seller.paymentSourceId &&
      row.PaymentSource.network === seller.network &&
      (input.paymentSourceType === "Web3CardanoV2" ||
        row.PaymentSource.policyId === seller.policyId) &&
      row.PaymentSource.paymentSourceType === input.paymentSourceType &&
      row.PaymentSource.smartContractAddress === input.smartContractAddress,
  );
  requireMatch(doMasumiPaymentAmountsMatch(row.RequestedFunds, input.amounts));
  for (const name of [
    "payByTime",
    "submitResultTime",
    "unlockTime",
    "externalDisputeUnlockTime",
  ] as const)
    requireMatch(row[name] === input[name]);
  validateQuoteTimes(row);
  // MPS uses LZ-String 1.5.0. The 1 KiB input cap bounds decoding to fewer
  // than 2,737 dictionary steps: each step consumes at least three bits.
  // Each entry adds at most one character to an existing entry, so output
  // stays below 3.8 million UTF-16 characters before the tighter size check.
  const decoded = LZString.decompressFromUint8Array(
    Buffer.from(row.blockchainIdentifier, "hex"),
  );
  requireMatch(typeof decoded === "string" && decoded.length <= 4096);
  const segments = decoded.split(".");
  const isV2 = input.paymentSourceType === "Web3CardanoV2";
  requireMatch(segments.length === (isV2 ? 5 : 4));
  requireMatch(
    /^[0-9a-f]{64}$/.test(segments[0].slice(0, 64)) &&
      segments[0].slice(64) === input.agentIdentifier,
  );
  requireMatch(segments[1] === input.identifierFromPurchaser);
  requireMatch(
    /^(?:[0-9a-f]{2}){1,1024}$/.test(segments[2]) &&
      /^(?:[0-9a-f]{2}){1,256}$/.test(segments[3]),
  );
  requireMatch(!isV2 || segments[4] === input.smartContractAddress);
  requireMatch(
    Buffer.from(LZString.compressToUint8Array(decoded)).toString("hex") ===
      row.blockchainIdentifier,
  );
  // The buyer node verifies the COSE signature before it creates a purchase.
  // This snapshot verifies the quoted fields; it does not attest that signature.
  const result: SellerQuote = {
    paymentId: row.id,
    blockchainIdentifier: row.blockchainIdentifier,
    agentIdentifier: row.agentIdentifier,
    sellerVkey: row.SmartContractWallet.walletVkey,
    inputHash: row.inputHash,
    identifierFromPurchaser: segments[1],
    Amounts: input.amounts.map((amount) => ({ ...amount })),
    payByTime: row.payByTime,
    submitResultTime: row.submitResultTime,
    unlockTime: row.unlockTime,
    externalDisputeUnlockTime: row.externalDisputeUnlockTime,
    paymentSourceType: row.PaymentSource.paymentSourceType,
    smartContractAddress: row.PaymentSource.smartContractAddress,
    sellerReturnAddress: row.sellerReturnAddress,
    ...(input.supportedPaymentSourceIndex === undefined
      ? {}
      : { supportedPaymentSourceIndex: input.supportedPaymentSourceIndex }),
  };
  requireMatch(
    !secrets.some((secret) => JSON.stringify(result).includes(secret)),
  );
  return result;
}

class VerificationFailure extends Error {
  constructor(readonly code: MpsSellerVerificationError["code"]) {
    super(ERROR_MESSAGES[code]);
  }
}

function requireMatch(matches: boolean): asserts matches {
  if (!matches) throw new VerificationFailure("identity_mismatch");
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new VerificationFailure("invalid_response");
  return parsed.data;
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    value.includes("?") ||
    value.includes("#") ||
    /\s/u.test(value)
  ) {
    throw new VerificationFailure("invalid_configuration");
  }
  return url.href.replace(/\/+$/, "");
}

function readResponse<T>(
  response: { data?: unknown; error?: unknown; response?: Response },
  schema: z.ZodType<T>,
): T {
  if (response.response?.status === 401 || response.response?.status === 403) {
    throw new VerificationFailure("permission_denied");
  }
  if (response.error !== undefined || response.response?.status !== 200) {
    throw new VerificationFailure("verification_unavailable");
  }
  return parse(
    z.object({ status: z.literal("success"), data: schema }),
    response.data,
  ).data;
}

function addressBytes(
  address: string,
  network: "Preprod" | "Mainnet",
): Uint8Array {
  try {
    const { prefix, bytes } = bech32.decodeToBytes(address);
    requireMatch(
      address === address.toLowerCase() &&
        prefix === (network === "Mainnet" ? "addr" : "addr_test") &&
        (bytes[0] & 15) === (network === "Mainnet" ? 1 : 0),
    );
    return bytes;
  } catch {
    throw new VerificationFailure("identity_mismatch");
  }
}

function paymentCredential(
  address: string,
  network: "Preprod" | "Mainnet",
): string {
  const bytes = addressBytes(address, network);
  const type = bytes[0] >> 4;
  requireMatch(
    (type === 0 && bytes.length === 57) || (type === 6 && bytes.length === 29),
  );
  return Buffer.from(bytes.slice(1, 29)).toString("hex");
}

async function findOnPages<T extends { id: string }>(
  fetchPage: (cursorId?: string) => Promise<T[]>,
  matches: (value: T) => boolean,
): Promise<T> {
  let cursorId: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchPage(cursorId);
    const matching = rows.filter(matches);
    if (matching.length > 1) throw new VerificationFailure("invalid_response");
    if (matching.length === 1) return matching[0];
    if (rows.length < PAGE_SIZE)
      throw new VerificationFailure("identity_mismatch");
    cursorId = rows[rows.length - 1].id;
    if (cursors.has(cursorId))
      throw new VerificationFailure("verification_unavailable");
    cursors.add(cursorId);
  }
  throw new VerificationFailure("verification_unavailable");
}

/** Verifies a read snapshot. It neither creates a payment nor proves settlement. */
export function createMpsSellerClient(
  sellerNode: MpsSellerNode & { network: "Preprod" | "Mainnet" },
  trustedNode: MpsSellerNode,
  trustedRegistry: MpsSellerNode,
) {
  const client = {
    async verifySeller(input: {
      agentIdentifier: string;
      walletId: string;
      paymentSourceId: string;
    }): Promise<Result<VerifiedMpsSeller, MpsSellerVerificationError>> {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      try {
        const configuration = z
          .object({
            seller: nodeSchema.extend({ network: networkSchema }),
            trusted: nodeSchema,
            registry: nodeSchema,
            input: z.object({
              agentIdentifier: agentIdentifierSchema,
              walletId: idSchema,
              paymentSourceId: idSchema,
            }),
          })
          .safeParse({
            seller: sellerNode,
            trusted: trustedNode,
            registry: trustedRegistry,
            input,
          });
        if (!configuration.success)
          throw new VerificationFailure("invalid_configuration");
        const {
          seller,
          trusted,
          registry,
          input: selection,
        } = configuration.data;
        let apiUrl: string;
        let trustedApiUrl: string;
        let registryApiUrl: string;
        try {
          apiUrl = canonicalUrl(seller.apiUrl);
          trustedApiUrl = canonicalUrl(trusted.apiUrl);
          registryApiUrl = canonicalUrl(registry.apiUrl);
        } catch {
          throw new VerificationFailure("invalid_configuration");
        }
        const secrets = [seller.apiKey, trusted.apiKey, registry.apiKey];
        if (
          [apiUrl, trustedApiUrl, registryApiUrl].some((url) =>
            secrets.some((secret) => url.includes(secret)),
          )
        )
          throw new VerificationFailure("invalid_configuration");
        const fetch = boundedFetch(controller);
        const developer = createPaymentApiClient({
          baseUrl: apiUrl,
          headers: { token: seller.apiKey },
          fetch,
        });
        const chain = createPaymentApiClient({
          baseUrl: trustedApiUrl,
          headers: { token: trusted.apiKey },
          fetch,
        });
        const registryClient = createRegistryApiClient({
          baseUrl: registryApiUrl,
          headers: { token: registry.apiKey },
          fetch,
        });
        const verify = async (): Promise<VerifiedMpsSeller> => {
          const key = readResponse(
            await getApiKeyStatus({ client: developer }),
            keySchema,
          );
          if (
            key.status !== "Active" ||
            !key.canRead ||
            !key.canPay ||
            key.canAdmin ||
            !key.NetworkLimit.includes(seller.network) ||
            !key.walletScopeEnabled ||
            !key.WalletScopes.some(
              (scope) => scope.hotWalletId === selection.walletId,
            )
          )
            throw new VerificationFailure("permission_denied");
          const wallet = await findOnPages(
            async (cursorId) =>
              readResponse(
                await getWalletList({
                  client: developer,
                  responseTransformer: undefined,
                  query: {
                    take: PAGE_SIZE,
                    cursorId,
                    paymentSourceId: selection.paymentSourceId,
                    walletType: "Selling",
                  },
                }),
                z.object({ Wallets: z.array(walletSchema).max(PAGE_SIZE) }),
              ).Wallets,
            (wallet) => wallet.id === selection.walletId,
          );
          requireMatch(
            wallet.type === "Selling" &&
              wallet.paymentSourceId === selection.paymentSourceId,
          );
          requireMatch(
            paymentCredential(wallet.walletAddress, seller.network) ===
              wallet.walletVkey,
          );
          if (wallet.collectionAddress !== null)
            paymentCredential(wallet.collectionAddress, seller.network);
          const readSources = async (
            client: typeof developer,
            cursorId?: string,
          ) =>
            readResponse(
              await getPaymentSource({
                client,
                responseTransformer: undefined,
                query: { take: PAGE_SIZE, cursorId },
              }),
              z.object({
                PaymentSources: z.array(sourceSchema).max(PAGE_SIZE),
              }),
            ).PaymentSources;
          const source = await findOnPages(
            (cursor) => readSources(developer, cursor),
            (source) => source.id === selection.paymentSourceId,
          );
          requireMatch(
            source.network === seller.network &&
              (source.paymentSourceType === "Web3CardanoV2" ||
                source.policyId === selection.agentIdentifier.slice(0, 56)),
          );
          const contractBytes = addressBytes(
            source.smartContractAddress,
            seller.network,
          );
          const contractType = contractBytes[0] >> 4;
          requireMatch(
            ((contractType === 1 || contractType === 3) &&
              contractBytes.length === 57) ||
              (contractType === 7 && contractBytes.length === 29),
          );
          await findOnPages(
            (cursor) => readSources(chain, cursor),
            (candidate) =>
              candidate.network === source.network &&
              (source.paymentSourceType === "Web3CardanoV2" ||
                candidate.policyId === source.policyId) &&
              candidate.paymentSourceType === source.paymentSourceType &&
              candidate.smartContractAddress === source.smartContractAddress,
          );
          const information = readResponse(
            await getPaymentInformation({
              client: registryClient,
              responseTransformer: undefined,
              query: { agentIdentifier: selection.agentIdentifier },
            }),
            registrySchema,
          );
          requireMatch(
            information.agentIdentifier === selection.agentIdentifier &&
              information.RegistrySource.policyId ===
                selection.agentIdentifier.slice(0, 56) &&
              information.paymentType === source.paymentSourceType,
          );
          requireMatch(
            information.status === "Online" || information.status === "Offline",
          );
          requireMatch(
            information.sellerWallet.address === wallet.walletAddress &&
              information.sellerWallet.vkey === wallet.walletVkey,
          );
          const metadata = readResponse(
            await getRegistryAgentIdentifier({
              client: chain,
              query: {
                agentIdentifier: selection.agentIdentifier,
                network: seller.network,
              },
            }),
            metadataSchema,
          );
          requireMatch(
            metadata.agentIdentifier === selection.agentIdentifier &&
              metadata.policyId === selection.agentIdentifier.slice(0, 56) &&
              metadata.policyId + metadata.assetName ===
                selection.agentIdentifier,
          );
          let amounts: Array<{ unit: string; amount: string }>;
          let trustedAmounts: Array<{ unit: string; amount: string }>;
          let supportedPaymentSourceIndex: number | undefined;
          if (source.paymentSourceType === "Web3CardanoV2") {
            requireMatch(metadata.Metadata.metadataVersion === 2);
            const sourceIndexes = information.SupportedPaymentSources.map(
              (value) =>
                parse(
                  z.object({ sourceIndex: z.number().int().min(0).max(24) }),
                  value,
                ).sourceIndex,
            );
            if (new Set(sourceIndexes).size !== sourceIndexes.length)
              throw new VerificationFailure("invalid_response");
            const matchesSource = (
              candidate: z.infer<typeof advertisedSourceSchema>,
            ) =>
              candidate.network === seller.network &&
              candidate.paymentSourceType === source.paymentSourceType &&
              candidate.address === source.smartContractAddress;
            const explicitSources = information.SupportedPaymentSources.map(
              (value) =>
                advertisedSourceSchema
                  .extend({ sourceIndex: z.number().int().min(0).max(24) })
                  .safeParse(value),
            ).filter((value) => value.success && matchesSource(value.data));
            const liveSources = (
              metadata.Metadata.supportedPaymentSources ?? []
            )
              .map((value) => advertisedSourceSchema.safeParse(value))
              .filter((value) => value.success && matchesSource(value.data));
            if (
              explicitSources.length !== 1 ||
              liveSources.length !== 1 ||
              !explicitSources[0].success ||
              !liveSources[0].success
            )
              throw new VerificationFailure("unsupported_pricing");
            supportedPaymentSourceIndex = explicitSources[0].data.sourceIndex;
            amounts = explicitSources[0].data.pricing.fixed.map(
              ({ asset, amount }) => ({ unit: asset, amount }),
            );
            trustedAmounts = liveSources[0].data.pricing.fixed.map(
              ({ asset, amount }) => ({ unit: asset, amount }),
            );
          } else {
            requireMatch(metadata.Metadata.metadataVersion === 1);
            const prices = z
              .array(z.object({ unit: unitSchema, amount: amountSchema }))
              .min(1)
              .max(7);
            const registryPricing = z
              .object({
                pricingType: z.literal("Fixed"),
                FixedPricing: z.object({ Amounts: prices }),
              })
              .safeParse(information.AgentPricing);
            const livePricing = z
              .object({ pricingType: z.literal("Fixed"), Pricing: prices })
              .safeParse(metadata.Metadata.AgentPricing);
            if (!registryPricing.success || !livePricing.success)
              throw new VerificationFailure("unsupported_pricing");
            amounts = registryPricing.data.FixedPricing.Amounts;
            trustedAmounts = livePricing.data.Pricing;
          }
          const totals = aggregateMasumiPaymentAmounts(amounts);
          if (
            !totals ||
            !Array.from(totals.values()).every((amount) => amount > 0n) ||
            !doMasumiPaymentAmountsMatch(amounts, trustedAmounts)
          )
            throw new VerificationFailure("unsupported_pricing");
          const balance = readResponse(
            await getBalance({
              client: chain,
              query: { address: wallet.walletAddress, network: seller.network },
            }),
            z.object({
              Balance: z
                .array(
                  z.object({
                    unit: z.string().max(120),
                    quantity: z
                      .number()
                      .int()
                      .nonnegative()
                      .max(Number.MAX_SAFE_INTEGER),
                  }),
                )
                .max(4096),
            }),
          );
          const nft = balance.Balance.filter(
            (asset) => asset.unit.toLowerCase() === selection.agentIdentifier,
          );
          requireMatch(nft.length === 1 && nft[0].quantity === 1);
          const snapshot: VerifiedMpsSeller = {
            apiUrl,
            apiKeyId: key.id,
            network: seller.network,
            agentIdentifier: selection.agentIdentifier,
            walletId: wallet.id,
            paymentSourceId: source.id,
            paymentSourceType: source.paymentSourceType,
            policyId: metadata.policyId,
            smartContractAddress: source.smartContractAddress,
            sellerVkey: wallet.walletVkey,
            walletAddress: wallet.walletAddress,
            collectionAddress: wallet.collectionAddress,
            amounts: Array.from(totals, ([unit, amount]) => ({
              unit,
              amount: amount.toString(),
            })),
            ...(supportedPaymentSourceIndex === undefined
              ? {}
              : { supportedPaymentSourceIndex }),
          };
          const serialized = JSON.stringify(snapshot);
          if (secrets.some((secret) => serialized.includes(secret)))
            throw new VerificationFailure("invalid_response");
          return snapshot;
        };
        const expired = new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            controller.abort();
            reject(new VerificationFailure("timeout"));
          }, DEADLINE_MS);
        });
        return ok(await Promise.race([verify(), expired]));
      } catch (error) {
        const code = controller.signal.aborted
          ? "timeout"
          : error instanceof VerificationFailure
            ? error.code
            : "verification_unavailable";
        return err({ code, message: ERROR_MESSAGES[code] });
      } finally {
        clearTimeout(deadline);
      }
    },
    /** Call once after persisting the intent. Recover any unknown outcome. */
    createQuote(
      input: SellerQuoteInput,
    ): Promise<Result<SellerQuote, SellerQuoteError>> {
      return runQuote(input, false);
    },
    /** Read only. Even not_found does not authorize another creation attempt. */
    recoverQuote(
      input: SellerQuoteInput,
    ): Promise<Result<SellerQuote, SellerQuoteError>> {
      return runQuote(input, true);
    },
  };

  async function runQuote(
    rawInput: SellerQuoteInput,
    recovering: boolean,
  ): Promise<Result<SellerQuote, SellerQuoteError>> {
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let attemptedPost = false;
    try {
      const input = parse(quoteInputSchema, rawInput);
      validateQuoteTimes(input);
      const operation = async (): Promise<
        Result<SellerQuote, SellerQuoteError>
      > => {
        const verification = await client.verifySeller(input);
        controller.signal.throwIfAborted();
        if (verification.isErr())
          return err(quoteError(recovering ? "ambiguous" : "rejected"));
        const seller = verification.value;
        requireMatch(
          seller.sellerVkey === input.sellerVkey &&
            seller.paymentSourceType === input.paymentSourceType &&
            seller.smartContractAddress === input.smartContractAddress,
        );
        requireMatch(
          seller.collectionAddress === input.sellerReturnAddress &&
            seller.supportedPaymentSourceIndex ===
              input.supportedPaymentSourceIndex,
        );
        requireMatch(
          doMasumiPaymentAmountsMatch(seller.amounts, input.amounts),
        );
        const api = createPaymentApiClient({
          baseUrl: seller.apiUrl,
          headers: { token: sellerNode.apiKey },
          fetch: boundedFetch(controller, !recovering),
        });
        const secrets = [
          sellerNode.apiKey,
          trustedNode.apiKey,
          trustedRegistry.apiKey,
        ];
        requireMatch(
          !secrets.some((secret) => JSON.stringify(input).includes(secret)),
        );
        if (!recovering) {
          requireMatch(
            Number(input.payByTime) > Date.now() &&
              Number(input.submitResultTime) >= Date.now() + 15 * 60_000,
          );
          controller.signal.throwIfAborted();
          attemptedPost = true;
          const response = await postPayment({
            client: api,
            responseTransformer: undefined,
            body: {
              network: seller.network,
              agentIdentifier: input.agentIdentifier,
              inputHash: input.inputHash,
              identifierFromPurchaser: input.identifierFromPurchaser,
              metadata: input.metadata,
              paymentSourceType: input.paymentSourceType,
              supportedPaymentSourceIndex: input.supportedPaymentSourceIndex,
              ...(input.sellerReturnAddress === null
                ? {}
                : { sellerReturnAddress: input.sellerReturnAddress }),
              payByTime: new Date(Number(input.payByTime)),
              submitResultTime: new Date(Number(input.submitResultTime)),
              unlockTime: new Date(Number(input.unlockTime)),
              externalDisputeUnlockTime: new Date(
                Number(input.externalDisputeUnlockTime),
              ),
            },
          });
          if (
            [400, 401, 403, 404, 422].includes(response.response?.status ?? 0)
          )
            return err(quoteError("rejected"));
          const row = readResponse(response, quoteResponseSchema);
          return ok(validateQuote(row, input, seller, secrets));
        }
        let cursorId: string | undefined;
        const cursors = new Set<string>();
        const candidates = new Map<string, unknown>();
        const recoveryRowSchema = z.object({
          id: idSchema,
          metadata: z.string().nullable(),
          inputHash: z.string().nullable(),
        });
        for (let page = 0; page < MAX_PAGES; page++) {
          const response = await getPayment({
            client: api,
            responseTransformer: undefined,
            query: {
              network: seller.network,
              limit: PAGE_SIZE,
              cursorId,
              filterAgentIdentifier: input.agentIdentifier,
              filterPaymentSourceType: input.paymentSourceType,
              filterSmartContractAddress: input.smartContractAddress,
              searchQuery: input.inputHash,
            },
          });
          const { Payments: rows } = readResponse(
            response,
            z.object({ Payments: z.array(z.unknown()).max(PAGE_SIZE) }),
          );
          let lastId: string | undefined;
          for (const row of rows) {
            const identity = parse(recoveryRowSchema, row);
            lastId = identity.id;
            if (identity.metadata !== input.metadata) continue;
            requireMatch(identity.inputHash === input.inputHash);
            const previous = candidates.get(identity.id);
            if (previous !== undefined)
              requireMatch(JSON.stringify(previous) === JSON.stringify(row));
            candidates.set(identity.id, row);
            if (candidates.size > 1) return err(quoteError("ambiguous"));
          }
          if (rows.length < PAGE_SIZE) {
            if (candidates.size === 0) return err(quoteError("not_found"));
            return ok(
              validateQuote(
                candidates.values().next().value,
                input,
                seller,
                secrets,
              ),
            );
          }
          if (lastId === undefined || cursors.has(lastId))
            return err(quoteError("ambiguous"));
          cursors.add(lastId);
          cursorId = lastId;
        }
        return err(quoteError("ambiguous"));
      };
      const expired = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new VerificationFailure("timeout"));
        }, DEADLINE_MS);
      });
      return await Promise.race([operation(), expired]);
    } catch {
      return err(
        quoteError(recovering || attemptedPost ? "ambiguous" : "rejected"),
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  return client;
}
