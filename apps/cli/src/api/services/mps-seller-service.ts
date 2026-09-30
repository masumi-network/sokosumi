import { redactErrorMessage } from "../../error-redaction.js";
import { type CoreHttpClient, createApiError } from "../http-client.js";
import { asRecord, requireId } from "../models/parse-helpers.js";

export interface MpsSeller {
  id: string;
  coworkerId: string;
  network: "Preprod" | "Mainnet";
  apiUrl: string;
  agentIdentifier: string;
  walletId: string;
  paymentSourceId: string;
  sellerVkey: string;
  walletAddress: string;
  sellerReturnAddress: string | null;
  paymentSourceType: "Web3CardanoV1" | "Web3CardanoV2";
  smartContractAddress: string;
  verifiedAt: string;
  revokedAt: string | null;
  paymentsEnabled: false;
}

export interface MpsSellerConnection {
  apiUrl: string;
  apiKey: string;
  agentIdentifier: string;
  walletId: string;
  paymentSourceId: string;
}

export function validateMpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "MPS URL must be an HTTPS URL without credentials, query, or fragment",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\s\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw new Error(
      "MPS URL must be an HTTPS URL without credentials, query, or fragment",
    );
  }
  return url.toString().replace(/\/+$/u, "");
}

function textField(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2_048 ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw new Error(`Invalid MPS seller response: invalid ${field}`);
  }
  return value;
}

function timestampField(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error(`Invalid MPS seller response: invalid ${field}`);
  }
  return value;
}

function parseSellerResponse(
  input: unknown,
  coworkerId: string,
): MpsSeller | null {
  const response = asRecord(input);
  if (response.data === null) return null;
  const value = asRecord(response.data);
  if (
    value.coworkerId !== coworkerId ||
    (value.network !== "Preprod" && value.network !== "Mainnet") ||
    (value.paymentSourceType !== "Web3CardanoV1" &&
      value.paymentSourceType !== "Web3CardanoV2") ||
    value.paymentsEnabled !== false
  ) {
    throw new Error(
      "Invalid MPS seller response: seller identity or payment state does not match",
    );
  }
  return {
    id: textField(value.id, "id"),
    coworkerId,
    network: value.network,
    apiUrl: validateMpsUrl(textField(value.apiUrl, "apiUrl")),
    agentIdentifier: textField(value.agentIdentifier, "agentIdentifier"),
    walletId: textField(value.walletId, "walletId"),
    paymentSourceId: textField(value.paymentSourceId, "paymentSourceId"),
    sellerVkey: textField(value.sellerVkey, "sellerVkey"),
    walletAddress: textField(value.walletAddress, "walletAddress"),
    sellerReturnAddress:
      value.sellerReturnAddress === null
        ? null
        : textField(value.sellerReturnAddress, "sellerReturnAddress"),
    paymentSourceType: value.paymentSourceType,
    smartContractAddress: textField(
      value.smartContractAddress,
      "smartContractAddress",
    ),
    verifiedAt: timestampField(value.verifiedAt, "verifiedAt"),
    revokedAt:
      value.revokedAt === null
        ? null
        : timestampField(value.revokedAt, "revokedAt"),
    paymentsEnabled: false,
  };
}

function sellerPath(coworkerId: string): string {
  requireId(coworkerId, "coworkerId");
  if (
    coworkerId === "." ||
    coworkerId === ".." ||
    /[\s\p{Cc}\p{Cf}]/u.test(coworkerId)
  ) {
    throw new Error("A valid Coworker ID is required");
  }
  return `/v1/coworkers/${encodeURIComponent(coworkerId)}/mps-seller`;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function mutationError(error: unknown, secrets: readonly string[] = []): Error {
  const fields = asRecord(error);
  const status = typeof fields.status === "number" ? fields.status : undefined;
  const failure =
    status === undefined
      ? new Error(redactErrorMessage(error, secrets))
      : createApiError(status, fields.body, secrets);
  if (status === undefined || status < 400 || status >= 500) {
    failure.message +=
      " The change may have succeeded. Run `sokosumi coworkers mps-status COWORKER_ID` on the same target before retrying.";
  }
  return failure;
}

export async function connectMpsSeller(
  client: CoreHttpClient,
  coworkerId: string,
  data: MpsSellerConnection,
  signal?: AbortSignal,
): Promise<MpsSeller> {
  const path = sellerPath(coworkerId);
  const apiUrl = validateMpsUrl(data.apiUrl);
  const agentIdentifier = data.agentIdentifier.toLowerCase();
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  try {
    const response = await client.post<unknown>(
      path,
      {
        apiUrl,
        apiKey: data.apiKey,
        agentIdentifier,
        walletId: data.walletId,
        paymentSourceId: data.paymentSourceId,
      },
      boundedSignal,
      { sensitiveValues: [data.apiKey], rejectRedirects: true },
    );
    boundedSignal.throwIfAborted();
    const seller = parseSellerResponse(response, coworkerId);
    if (
      !seller ||
      seller.revokedAt !== null ||
      seller.apiUrl !== apiUrl ||
      seller.agentIdentifier !== agentIdentifier ||
      seller.walletId !== data.walletId ||
      seller.paymentSourceId !== data.paymentSourceId
    ) {
      throw new Error(
        "Invalid MPS seller response: connected seller does not match the request",
      );
    }
    return seller;
  } catch (error) {
    throw mutationError(error, [data.apiKey, encodeURIComponent(data.apiKey)]);
  }
}

export async function fetchMpsSeller(
  client: CoreHttpClient,
  coworkerId: string,
  signal?: AbortSignal,
): Promise<MpsSeller | null> {
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  const response = await client.get<unknown>(
    sellerPath(coworkerId),
    boundedSignal,
  );
  boundedSignal.throwIfAborted();
  return parseSellerResponse(response, coworkerId);
}

export async function revokeMpsSeller(
  client: CoreHttpClient,
  coworkerId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<MpsSeller> {
  requireId(bindingId, "bindingId");
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  try {
    const response = await client.post<unknown>(
      `${sellerPath(coworkerId)}/revoke`,
      { bindingId },
      boundedSignal,
      { rejectRedirects: true },
    );
    boundedSignal.throwIfAborted();
    const seller = parseSellerResponse(response, coworkerId);
    if (!seller || seller.id !== bindingId || seller.revokedAt === null) {
      throw new Error(
        "Invalid MPS seller response: revocation could not be confirmed",
      );
    }
    return seller;
  } catch (error) {
    throw mutationError(error);
  }
}
