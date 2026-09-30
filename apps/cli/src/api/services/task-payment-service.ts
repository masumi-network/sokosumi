import { redactErrorMessage } from "../../error-redaction.js";
import { type CoreHttpClient, createApiError } from "../http-client.js";
import { asRecord } from "../models/parse-helpers.js";

export interface TaskPaymentTerms {
  paymentId: string;
  blockchainIdentifier: string;
  identifierFromPurchaser: string;
  agentIdentifier: string;
  sellerVkey: string;
  inputHash: string;
  paymentSourceType: "Web3CardanoV1" | "Web3CardanoV2";
  supportedPaymentSourceIndex?: number;
  smartContractAddress: string;
  sellerReturnAddress: string | null;
  Amounts: { amount: string; unit: string }[];
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
}

export interface TaskPaymentQuote {
  id: string;
  taskId: string;
  coworkerId: string;
  sellerBindingId: string;
  billingOwnerId: string;
  billingOrganizationId: string | null;
  network: "Preprod" | "Mainnet";
  state:
    | "unresolved"
    | "quoted"
    | "approved"
    | "revoked"
    | "expired"
    | "consumed";
  inputHash: string;
  termsHash: string | null;
  terms: TaskPaymentTerms | null;
  quotedCredits: number | null;
  maxCredits: number | null;
  expiresAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  consumedAt: string | null;
  paymentsEnabled: false;
}

export interface CreateTaskPaymentQuote {
  idempotencyKey: string;
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
}

export function validatePaymentId(value: string, label: string): string {
  if (
    !value ||
    value.length > 200 ||
    value === "." ||
    value === ".." ||
    /[\s\p{Cc}\p{Cf}/\\%]/u.test(value)
  ) {
    throw new Error(
      `${label} must be a nonempty ID without whitespace, slashes, or percent signs`,
    );
  }
  return value;
}

export function validatePaymentDeadline(value: string, label: string): string {
  const pattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
  const utcDate = `${value.slice(0, 19)}Z`;
  if (
    !pattern.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(utcDate)) ||
    new Date(utcDate).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error(`${label} must be a valid ISO timestamp with a timezone`);
  }
  return value;
}

export function validatePaymentCredits(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 922_337_203) {
    throw new Error(
      "--max-credits must be a positive number no greater than 922337203",
    );
  }
  if (Number(value.toFixed(10)) !== value) {
    throw new Error("--max-credits must use at most 10 decimal places");
  }
  return value;
}

function textField(
  value: unknown,
  field: string,
  maxLength = 250,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value) ||
    value.length > maxLength ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw new Error(`Invalid payment quote response: invalid ${field}`);
  }
  return value;
}

function hashField(value: unknown, field: string): string {
  const text = textField(value, field);
  if (!/^[0-9a-f]{64}$/u.test(text))
    throw new Error(`Invalid payment quote response: invalid ${field}`);
  return text;
}

function timestampField(value: unknown, field: string): string {
  return validatePaymentDeadline(textField(value, field), field);
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestampField(value, field);
}

function creditField(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 922_337_203
  ) {
    throw new Error(`Invalid payment quote response: invalid ${field}`);
  }
  return value;
}

function millisField(value: unknown, field: string): string {
  const text = textField(value, field, 19);
  if (
    !/^\d+$/u.test(text) ||
    BigInt(text) <= 0n ||
    !Number.isFinite(new Date(Number(text)).getTime())
  ) {
    throw new Error(`Invalid payment quote response: invalid ${field}`);
  }
  return text;
}

function parseTerms(input: unknown): TaskPaymentTerms {
  const value = asRecord(input);
  const paymentSourceType = value.paymentSourceType;
  if (
    paymentSourceType !== "Web3CardanoV1" &&
    paymentSourceType !== "Web3CardanoV2"
  ) {
    throw new Error(
      "Invalid payment quote response: invalid paymentSourceType",
    );
  }
  const index = value.supportedPaymentSourceIndex;
  if (
    index !== undefined &&
    (typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 24)
  ) {
    throw new Error(
      "Invalid payment quote response: invalid supportedPaymentSourceIndex",
    );
  }
  if (
    !Array.isArray(value.Amounts) ||
    value.Amounts.length < 1 ||
    value.Amounts.length > 7
  ) {
    throw new Error("Invalid payment quote response: invalid Amounts");
  }
  return {
    paymentId: textField(value.paymentId, "paymentId"),
    blockchainIdentifier: textField(
      value.blockchainIdentifier,
      "blockchainIdentifier",
      8000,
    ),
    identifierFromPurchaser: textField(
      value.identifierFromPurchaser,
      "identifierFromPurchaser",
      26,
    ),
    agentIdentifier: textField(value.agentIdentifier, "agentIdentifier"),
    sellerVkey: textField(value.sellerVkey, "sellerVkey", 56),
    inputHash: hashField(value.inputHash, "terms.inputHash"),
    paymentSourceType,
    ...(index === undefined ? {} : { supportedPaymentSourceIndex: index }),
    smartContractAddress: textField(
      value.smartContractAddress,
      "smartContractAddress",
    ),
    sellerReturnAddress:
      value.sellerReturnAddress === null
        ? null
        : textField(
            value.sellerReturnAddress,
            "sellerReturnAddress",
            250,
            true,
          ),
    Amounts: value.Amounts.map((raw) => {
      const amount = asRecord(raw);
      const amountText = textField(amount.amount, "amount", 25);
      if (!/^\d+$/u.test(amountText) || BigInt(amountText) <= 0n) {
        throw new Error("Invalid payment quote response: invalid amount");
      }
      return {
        amount: amountText,
        unit: textField(amount.unit, "unit", 150, true),
      };
    }),
    payByTime: millisField(value.payByTime, "payByTime"),
    submitResultTime: millisField(value.submitResultTime, "submitResultTime"),
    unlockTime: millisField(value.unlockTime, "unlockTime"),
    externalDisputeUnlockTime: millisField(
      value.externalDisputeUnlockTime,
      "externalDisputeUnlockTime",
    ),
  };
}

function parseQuote(
  input: unknown,
  taskId: string,
  quoteId?: string,
): TaskPaymentQuote {
  const value = asRecord(asRecord(input).data);
  const network = value.network;
  const state = value.state;
  if (
    value.taskId !== taskId ||
    (quoteId !== undefined && value.id !== quoteId) ||
    (network !== "Preprod" && network !== "Mainnet") ||
    value.paymentsEnabled !== false ||
    (state !== "unresolved" &&
      state !== "quoted" &&
      state !== "approved" &&
      state !== "revoked" &&
      state !== "expired" &&
      state !== "consumed")
  ) {
    throw new Error(
      "Invalid payment quote response: identity or state does not match",
    );
  }
  const terms = value.terms === null ? null : parseTerms(value.terms);
  const termsHash =
    value.termsHash === null ? null : hashField(value.termsHash, "termsHash");
  const inputHash = hashField(value.inputHash, "inputHash");
  const quotedCredits = creditField(value.quotedCredits, "quotedCredits");
  if (
    (terms === null) !== (termsHash === null) ||
    (terms === null) !== (quotedCredits === null) ||
    (terms && terms.inputHash !== inputHash) ||
    ((state === "quoted" || state === "approved" || state === "consumed") &&
      !terms)
  ) {
    throw new Error(
      "Invalid payment quote response: incomplete or inconsistent terms",
    );
  }
  return {
    id: textField(value.id, "id"),
    taskId,
    coworkerId: textField(value.coworkerId, "coworkerId"),
    sellerBindingId: textField(value.sellerBindingId, "sellerBindingId"),
    billingOwnerId: textField(value.billingOwnerId, "billingOwnerId"),
    billingOrganizationId:
      value.billingOrganizationId === null
        ? null
        : textField(value.billingOrganizationId, "billingOrganizationId"),
    network,
    state,
    inputHash,
    termsHash,
    terms,
    quotedCredits,
    maxCredits: creditField(value.maxCredits, "maxCredits"),
    expiresAt: timestampField(value.expiresAt, "expiresAt"),
    approvedAt: nullableTimestamp(value.approvedAt, "approvedAt"),
    revokedAt: nullableTimestamp(value.revokedAt, "revokedAt"),
    consumedAt: nullableTimestamp(value.consumedAt, "consumedAt"),
    paymentsEnabled: false,
  };
}

function quotePath(taskId: string, quoteId?: string): string {
  const path = `/v1/tasks/${encodeURIComponent(validatePaymentId(taskId, "Task ID"))}/payment-quotes`;
  return quoteId === undefined
    ? path
    : `${path}/${encodeURIComponent(validatePaymentId(quoteId, "Quote ID"))}`;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function createTaskPaymentQuote(
  client: CoreHttpClient,
  taskId: string,
  data: CreateTaskPaymentQuote,
  signal?: AbortSignal,
): Promise<TaskPaymentQuote> {
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  const path = quotePath(taskId);
  try {
    const response = await client.post<unknown>(path, data, boundedSignal, {
      rejectRedirects: true,
    });
    boundedSignal.throwIfAborted();
    return parseQuote(response, taskId);
  } catch (error) {
    const fields = asRecord(error);
    const status =
      typeof fields.status === "number" ? fields.status : undefined;
    if (status !== undefined && status >= 400 && status < 500) throw error;
    const failure =
      status === undefined
        ? new Error(redactErrorMessage(error))
        : createApiError(status, fields.body);
    failure.message +=
      " Quote creation may have succeeded. Retry tasks payment-quote with the same --request-id and deadlines for read-only recovery.";
    throw failure;
  }
}

export async function fetchTaskPaymentQuote(
  client: CoreHttpClient,
  taskId: string,
  quoteId: string,
  signal?: AbortSignal,
): Promise<TaskPaymentQuote> {
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  const response = await client.get<unknown>(
    quotePath(taskId, quoteId),
    boundedSignal,
  );
  boundedSignal.throwIfAborted();
  return parseQuote(response, taskId, quoteId);
}

export async function approveTaskPaymentQuote(
  client: CoreHttpClient,
  taskId: string,
  quoteId: string,
  termsHash: string,
  maxCredits: number,
  signal?: AbortSignal,
): Promise<TaskPaymentQuote> {
  hashField(termsHash, "termsHash");
  validatePaymentCredits(maxCredits);
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  const response = await client.post<unknown>(
    `${quotePath(taskId, quoteId)}/approve`,
    { termsHash, maxCredits },
    boundedSignal,
    { rejectRedirects: true },
  );
  boundedSignal.throwIfAborted();
  const quote = parseQuote(response, taskId, quoteId);
  if (
    quote.state !== "approved" ||
    quote.termsHash !== termsHash ||
    quote.maxCredits !== maxCredits ||
    quote.approvedAt === null
  ) {
    throw new Error(
      "Invalid payment quote response: approval could not be confirmed",
    );
  }
  return quote;
}

export async function revokeTaskPaymentQuote(
  client: CoreHttpClient,
  taskId: string,
  quoteId: string,
  signal?: AbortSignal,
): Promise<TaskPaymentQuote> {
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  const response = await client.post<unknown>(
    `${quotePath(taskId, quoteId)}/revoke`,
    {},
    boundedSignal,
    { rejectRedirects: true },
  );
  boundedSignal.throwIfAborted();
  const quote = parseQuote(response, taskId, quoteId);
  if (quote.state !== "revoked" || quote.revokedAt === null) {
    throw new Error(
      "Invalid payment quote response: revocation could not be confirmed",
    );
  }
  return quote;
}
