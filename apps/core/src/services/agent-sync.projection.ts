import { z } from "@hono/zod-openapi";
import {
  AgentEntryType,
  AgentStatus,
  PaymentType,
  POSTGRES_BIGINT_MAX,
  PricingType,
} from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  normalizeMasumiPaymentUnit,
  parseVersionedAgentIdentifier,
} from "@sokosumi/masumi";
import type { PostRegistryDiffResponse } from "@sokosumi/masumi/clients";

import { getEnv } from "@/config/env";
import {
  type CardanoV2ReadySource,
  isCardanoV2SourceReady,
} from "@/helpers/agent";

const POSTGRES_INT_MAX = 2_147_483_647;
const MAX_PAYMENT_SOURCE_INDEX = 24;
const MAX_PAYMENT_SOURCES = MAX_PAYMENT_SOURCE_INDEX + 1;
const MAX_PAYMENT_SOURCE_AMOUNTS = 7;
const MAX_LEGACY_PRICING_AMOUNTS = 100;
const MAX_REGISTRY_TAGS = 100;
const MAX_REGISTRY_EXAMPLE_OUTPUTS = 100;
const POSTGRES_BIGINT_MAX_STRING = POSTGRES_BIGINT_MAX.toString();

function normalizeUnsignedInteger(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  return value.replace(/^0+/, "") || "0";
}

function exceedsDatabaseBigInt(value: unknown): boolean {
  const normalized = normalizeUnsignedInteger(value);
  if (normalized === null) {
    return false;
  }
  return (
    normalized.length > POSTGRES_BIGINT_MAX_STRING.length ||
    (normalized.length === POSTGRES_BIGINT_MAX_STRING.length &&
      normalized > POSTGRES_BIGINT_MAX_STRING)
  );
}

function parsePositiveDatabaseBigInt(value: unknown): bigint | null {
  const normalized = normalizeUnsignedInteger(value);
  if (normalized === null || exceedsDatabaseBigInt(normalized)) {
    return null;
  }
  const parsed = BigInt(normalized);
  return parsed > 0n ? parsed : null;
}

interface ParsedDatabaseAmount {
  amount: bigint;
  unit: string;
}

function isParsedDatabaseAmount(value: {
  amount: bigint | null;
  unit: string;
}): value is ParsedDatabaseAmount {
  return value.amount !== null;
}

function isDatabaseInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= POSTGRES_INT_MAX
  );
}

function isValidRegistryDate(value: unknown): boolean {
  return (
    (typeof value === "string" || value instanceof Date) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isValidEmail(email: string | null | undefined): email is string {
  if (!email) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emptyStringToNull(value: string | null | undefined): string | null {
  if (!value || value === "") {
    return null;
  }

  return value;
}

function convertStatus(
  status: "Online" | "Offline" | "Deregistered" | "Invalid" | unknown,
): AgentStatus {
  switch (status) {
    case "Online":
      return AgentStatus.ONLINE;
    case "Offline":
      return AgentStatus.OFFLINE;
    case "Deregistered":
      return AgentStatus.DEREGISTERED;
    case "Invalid":
      return AgentStatus.INVALID;
    default:
      return AgentStatus.INVALID;
  }
}

function convertPaymentType(
  paymentType: "Web3CardanoV1" | "Web3CardanoV2" | "None" | unknown,
) {
  switch (paymentType) {
    case "Web3CardanoV1":
      return PaymentType.WEB3_CARDANO_V1;
    case "Web3CardanoV2":
      return PaymentType.WEB3_CARDANO_V2;
    case "None":
      return PaymentType.NONE;
    default:
      return PaymentType.UNKNOWN;
  }
}

export function convertEntryType(
  type: "Standard" | "OpenApi" | "X402" | unknown,
): AgentEntryType {
  switch (type) {
    case undefined:
    case null:
    case "Standard":
      return AgentEntryType.STANDARD;
    case "OpenApi":
      return AgentEntryType.OPEN_API;
    case "X402":
      return AgentEntryType.X402;
    default:
      return AgentEntryType.UNKNOWN;
  }
}

// The registry serves AgentPricing as a loose union (V2 entries have no
// top-level pricing at all), so validate structurally instead of trusting the
// generated type.
const registryAgentPricingSchema = z.object({
  pricingType: z.string(),
  FixedPricing: z
    .object({
      Amounts: z
        .array(z.object({ amount: z.string(), unit: z.string() }))
        .max(MAX_LEGACY_PRICING_AMOUNTS),
    })
    .optional(),
});

const registryPaymentSourcePricingSchema = z.discriminatedUnion("pricingType", [
  z.object({
    pricingType: z.literal("Fixed"),
    fixed: z.array(
      z.object({
        asset: z.string(),
        amount: z.string(),
        decimals: z.number().optional(),
      }),
    ),
  }),
  z.object({
    pricingType: z.literal("Dynamic"),
    dynamic: z
      .array(z.object({ asset: z.string(), decimals: z.number() }))
      .optional(),
  }),
  z.object({ pricingType: z.literal("Free") }),
]);

/** Every registry-controlled field dereferenced by the storage projection. */
const registryStorageEntrySchema = z.object({
  id: z.string(),
  statusUpdatedAt: z.union([z.string(), z.date()]),
  agentIdentifier: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  apiBaseUrl: z.string().nullable(),
  // The V2 surface fields are optional on purpose: a registry deployment that
  // predates them must degrade to the V1 projection (convertEntryType maps a
  // missing type to STANDARD), not quarantine its entire catalog as INVALID.
  type: z.string().nullish(),
  openApiSpecUrl: z.string().nullish(),
  x402ResourcesUrl: z.string().nullish(),
  supersededByAgentIdentifier: z.string().nullish(),
  metadataVersion: z.number(),
  lastUptimeCheck: z.union([z.string(), z.date()]),
  uptimeCount: z.number(),
  uptimeCheckCount: z.number(),
  Capability: z
    .object({ name: z.string().nullable(), version: z.string().nullable() })
    .nullable(),
  authorName: z.string().nullable(),
  authorContactEmail: z.string().nullable(),
  authorContactOther: z.string().nullable(),
  image: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  authorOrganization: z.string().nullable(),
  status: z.string(),
  otherLegal: z.string().nullable(),
  termsAndCondition: z.string().nullable(),
  privacyPolicy: z.string().nullable(),
  paymentType: z.string(),
  AgentPricing: z.unknown(),
  SupportedPaymentSources: z
    .array(
      z.object({
        sourceIndex: z.number(),
        chain: z.string(),
        network: z.string(),
        paymentSourceType: z.string().nullable(),
        address: z.string(),
        payTo: z.string().nullable(),
        scheme: z.string().nullable(),
        resource: z.string().nullable(),
        pricing: registryPaymentSourcePricingSchema,
      }),
    )
    .nullish(),
  ExampleOutput: z.array(
    z.object({
      mimeType: z.string(),
      name: z.string(),
      url: z.string(),
    }),
  ),
});

export interface ParsedAgentPricing {
  pricingType: PricingType;
  fixedPricingAmounts?: { amount: bigint; unit: string }[];
}

function parseEntryAgentPricing(
  pricing: unknown,
  agentIdentifier: string,
): ParsedAgentPricing {
  if (pricing === null || pricing === undefined) {
    // Legitimate for V2/pointer entries (pricing is per payment source).
    return {
      pricingType: PricingType.UNKNOWN,
    };
  }
  const parsed = registryAgentPricingSchema.safeParse(pricing);
  if (!parsed.success) {
    console.warn(
      `[sync/agents] Malformed pricing for entry ${agentIdentifier}; storing as UNKNOWN (agent stays unavailable)`,
    );
    return {
      pricingType: PricingType.UNKNOWN,
    };
  }

  switch (parsed.data.pricingType) {
    case "Fixed": {
      const amounts = parsed.data.FixedPricing?.Amounts ?? [];

      // Intentionally treat empty/invalid fixed pricing as unknown to avoid
      // exposing malformed registry pricing as a valid fixed-price agent. The
      // upper bound matches PostgreSQL BIGINT so a schema-valid registry value
      // cannot fail later during Prisma persistence and park the sync cursor.
      const parsedAmounts = amounts.map((amount) => ({
        amount: parsePositiveDatabaseBigInt(amount.amount),
        unit: normalizeMasumiPaymentUnit(amount.unit),
      }));
      const validAmounts = parsedAmounts.filter(isParsedDatabaseAmount);
      if (
        parsedAmounts.length === 0 ||
        validAmounts.length !== parsedAmounts.length
      ) {
        console.warn(
          `[sync/agents] Invalid fixed pricing amount for entry ${agentIdentifier}; storing as UNKNOWN (agent stays unavailable)`,
        );
        return {
          pricingType: PricingType.UNKNOWN,
        };
      }

      return {
        pricingType: PricingType.FIXED,
        fixedPricingAmounts: validAmounts,
      };
    }
    case "Free": {
      return {
        pricingType: PricingType.FREE,
      };
    }
    default: {
      return {
        pricingType: PricingType.UNKNOWN,
      };
    }
  }
}

export type RegistryDiffEntry =
  PostRegistryDiffResponse["data"]["entries"][number];
type RegistryPaymentSource =
  RegistryDiffEntry["SupportedPaymentSources"][number];

const registryEntryCursorSchema = z.object({
  id: z.string().min(1),
  statusUpdatedAt: z.union([z.string(), z.date()]),
});

export interface RegistryEntryCursor {
  id: string;
  statusUpdatedAt: Date;
}

/**
 * Extracts cursor fields independently from the storage projection. Cursor
 * data cannot be quarantined: advancing with an invalid timestamp can skip
 * later registry changes, so callers must park until the registry is fixed.
 */
export function getRegistryEntryCursor(
  entry: unknown,
): RegistryEntryCursor | null {
  const parsed = registryEntryCursorSchema.safeParse(entry);
  if (!parsed.success || !isValidRegistryDate(parsed.data.statusUpdatedAt)) {
    return null;
  }
  return {
    id: parsed.data.id,
    statusUpdatedAt: new Date(parsed.data.statusUpdatedAt),
  };
}

/**
 * Returns why a registry entry cannot be persisted safely. The generated
 * registry client applies TypeScript types but no runtime validation, while
 * Prisma maps Int/BigInt to bounded PostgreSQL types. Invalid external data is
 * quarantined and the cursor advances instead of retrying it forever.
 */
export function getRegistryEntryStorageIssue(
  entry: RegistryDiffEntry,
): string | null {
  const parsedEntry = registryStorageEntrySchema.safeParse(entry);
  if (!parsedEntry.success) {
    const firstIssue = parsedEntry.error.issues[0];
    const path = firstIssue?.path.join(".") || "entry";
    return `${path} has invalid runtime shape`;
  }
  const safeEntry = parsedEntry.data;
  const integerFields = [
    ["metadataVersion", safeEntry.metadataVersion],
    ["uptimeCount", safeEntry.uptimeCount],
    ["uptimeCheckCount", safeEntry.uptimeCheckCount],
  ] as const;
  for (const [field, value] of integerFields) {
    if (!isDatabaseInt(value)) {
      return `${field} is outside the PostgreSQL INT range`;
    }
  }

  if (!isValidRegistryDate(safeEntry.lastUptimeCheck)) {
    return "lastUptimeCheck is not a valid date";
  }
  if (!isValidRegistryDate(safeEntry.statusUpdatedAt)) {
    return "statusUpdatedAt is not a valid date";
  }
  if ((safeEntry.tags?.length ?? 0) > MAX_REGISTRY_TAGS) {
    return `tags exceeds ${MAX_REGISTRY_TAGS} entries`;
  }
  if (safeEntry.ExampleOutput.length > MAX_REGISTRY_EXAMPLE_OUTPUTS) {
    return `ExampleOutput exceeds ${MAX_REGISTRY_EXAMPLE_OUTPUTS} entries`;
  }

  const legacyPricing = registryAgentPricingSchema.safeParse(
    safeEntry.AgentPricing,
  );
  if (legacyPricing.success && legacyPricing.data.pricingType === "Fixed") {
    const amounts = legacyPricing.data.FixedPricing?.Amounts ?? [];
    if (amounts.some((amount) => exceedsDatabaseBigInt(amount.amount))) {
      return "AgentPricing contains an amount outside the PostgreSQL BIGINT range";
    }
  } else if (
    safeEntry.AgentPricing &&
    typeof safeEntry.AgentPricing === "object" &&
    "pricingType" in safeEntry.AgentPricing &&
    safeEntry.AgentPricing.pricingType === "Fixed"
  ) {
    return `AgentPricing exceeds ${MAX_LEGACY_PRICING_AMOUNTS} amounts or is malformed`;
  }

  const supportedPaymentSources = safeEntry.SupportedPaymentSources ?? [];
  if (supportedPaymentSources.length > MAX_PAYMENT_SOURCES) {
    return `SupportedPaymentSources exceeds ${MAX_PAYMENT_SOURCES} entries`;
  }
  for (const source of supportedPaymentSources) {
    if (
      !isDatabaseInt(source.sourceIndex) ||
      source.sourceIndex > MAX_PAYMENT_SOURCE_INDEX
    ) {
      return `payment source index is outside 0..${MAX_PAYMENT_SOURCE_INDEX}`;
    }
    if (source.pricing.pricingType !== "Fixed") {
      continue;
    }
    if (source.pricing.fixed.length > MAX_PAYMENT_SOURCE_AMOUNTS) {
      return `payment source ${source.sourceIndex} exceeds ${MAX_PAYMENT_SOURCE_AMOUNTS} amounts`;
    }
    for (const amount of source.pricing.fixed) {
      if (exceedsDatabaseBigInt(amount.amount)) {
        return `payment source ${source.sourceIndex} contains an amount outside the PostgreSQL BIGINT range`;
      }
      if (
        amount.decimals !== undefined &&
        (!isDatabaseInt(amount.decimals) || amount.decimals > 255)
      ) {
        return `payment source ${source.sourceIndex} has invalid decimals`;
      }
    }
  }

  return null;
}

function normalizeRegistryIdentifier(identifier: string): string {
  return isV2RegistryIdentifier(identifier)
    ? identifier.toLowerCase()
    : identifier;
}

export function normalizeRegistryEntry(
  entry: RegistryDiffEntry,
): RegistryDiffEntry {
  return {
    ...entry,
    agentIdentifier: normalizeRegistryIdentifier(entry.agentIdentifier),
    supersededByAgentIdentifier: entry.supersededByAgentIdentifier
      ? normalizeRegistryIdentifier(entry.supersededByAgentIdentifier)
      : entry.supersededByAgentIdentifier,
    // Defensive `?? []`, like every other read of this field: a registry
    // deployment predating the V2 surface omits it entirely, and throwing here
    // parks the sync cursor on every entry instead of degrading to V1.
    SupportedPaymentSources: (entry.SupportedPaymentSources ?? []).map(
      (source) =>
        source.chain === "Cardano" &&
        source.paymentSourceType === "Web3CardanoV2"
          ? { ...source, address: source.address.toLowerCase() }
          : source,
    ),
  };
}

export interface RegistryAgentVersion {
  registryIdentity: string;
  registryVersion: number;
  isValid: boolean;
}

export function resolveRegistryAgentVersion(
  entry: RegistryDiffEntry,
): RegistryAgentVersion {
  // Version semantics are a property of the V2 registry POLICY, not of the
  // payment type: free and EVM-only V2 agents carry paymentType "None" but
  // are still versioned. Keying on the policy prefix (like the registry
  // service does) keeps one stable Agent row across their revisions too.
  if (!isV2RegistryIdentifier(entry.agentIdentifier)) {
    return {
      registryIdentity: entry.agentIdentifier,
      registryVersion: 0,
      isValid: true,
    };
  }

  const parsed = parseVersionedAgentIdentifier(entry.agentIdentifier);
  if (!parsed) {
    console.warn(
      `[sync/agents] Invalid V2 version suffix for entry ${entry.agentIdentifier}; storing as unavailable`,
    );
    return {
      registryIdentity: entry.agentIdentifier,
      registryVersion: 0,
      isValid: false,
    };
  }

  return {
    ...parsed,
    isValid: true,
  };
}

/**
 * Projects a registry payment source's own pricing into the local pricing
 * shape. Dynamic pricing is unsupported and maps to UNKNOWN (agent stays
 * unavailable), matching the V1 behavior.
 */
function projectSourcePricing(
  pricing: RegistryPaymentSource["pricing"],
  agentIdentifier: string,
): ParsedAgentPricing {
  switch (pricing.pricingType) {
    case "Fixed": {
      if (pricing.fixed.length > MAX_PAYMENT_SOURCE_AMOUNTS) {
        console.warn(
          `[sync/agents] Too many source pricing amounts for entry ${agentIdentifier}; storing as UNKNOWN`,
        );
        return { pricingType: PricingType.UNKNOWN };
      }
      const amounts = pricing.fixed.map((fixedAmount) => ({
        unit: normalizeMasumiPaymentUnit(fixedAmount.asset),
        amount: parsePositiveDatabaseBigInt(fixedAmount.amount),
      }));
      const validAmounts = amounts.filter(isParsedDatabaseAmount);
      if (amounts.length === 0 || validAmounts.length !== amounts.length) {
        console.warn(
          `[sync/agents] Invalid source pricing amount for entry ${agentIdentifier}; storing as UNKNOWN`,
        );
        return { pricingType: PricingType.UNKNOWN };
      }
      return {
        pricingType: PricingType.FIXED,
        fixedPricingAmounts: validAmounts,
      };
    }
    case "Free":
      return { pricingType: PricingType.FREE };
    // The payment node's third pricing type, deliberately unsupported rather
    // than overlooked. The catalog advertises one price per agent and charges
    // credits against it before the hire; a dynamically priced source has no
    // price to advertise or charge, so there is nothing honest to show. UNKNOWN
    // keeps the agent out of the catalog (buildAvailableAgentWhereClause
    // excludes it) instead of guessing a number the seller never quoted.
    case "Dynamic":
      return { pricingType: PricingType.UNKNOWN };
    // Anything the node adds later lands here and is likewise excluded.
    default:
      return { pricingType: PricingType.UNKNOWN };
  }
}

/**
 * V2 entries price each payment source independently. The agent-level pricing
 * (credits math, availability) comes from the Cardano V2 source matching this
 * deployment's network; no match means the agent is not purchasable here.
 * Every currently purchase-ready source must project the same pricing because
 * the catalog exposes one agent-level price while the seller selects a source.
 * Different source prices stay unavailable instead of advertising a ceiling
 * that job creation must reject. Readiness changes trigger a registry replay.
 */
function projectV2AgentPricing(
  entry: RegistryDiffEntry,
  readySources: readonly CardanoV2ReadySource[],
): ParsedAgentPricing {
  const network = getEnv().NETWORK;
  // Defensive `?? []`: the generated client does no runtime validation, so a
  // registry deployment predating the V2 surface must not crash the sync.
  const matching = (entry.SupportedPaymentSources ?? []).filter(
    (candidate) =>
      candidate.chain === "Cardano" &&
      candidate.network === network &&
      candidate.paymentSourceType === "Web3CardanoV2",
  );
  const readyMatching = matching.filter((candidate) =>
    isCardanoV2SourceReady(
      entry.agentIdentifier,
      candidate.address,
      readySources,
    ),
  );
  const isReadyProjection = readyMatching.length > 0;
  const projected = (isReadyProjection ? readyMatching : matching).map(
    (source) => projectSourcePricing(source.pricing, entry.agentIdentifier),
  );
  const pricing = projected[0];
  if (!pricing) {
    return { pricingType: PricingType.UNKNOWN };
  }
  // Applies to the unready fallback too: with no ready source there is no
  // basis for preferring one candidate's price, and taking the first would
  // advertise an arbitrary one of several disagreeing prices.
  if (
    projected.some(
      (candidate) => !areProjectedPricingsEqual(pricing, candidate),
    )
  ) {
    console.warn(
      `[sync/agents] Entry ${entry.agentIdentifier} has ${isReadyProjection ? "purchase-ready" : "matching"} Cardano V2 sources with different pricing; storing as UNKNOWN (agent stays unavailable)`,
    );
    return { pricingType: PricingType.UNKNOWN };
  }
  return pricing;
}

function areProjectedPricingsEqual(
  left: ParsedAgentPricing,
  right: ParsedAgentPricing,
): boolean {
  if (left.pricingType !== right.pricingType) {
    return false;
  }
  const aggregate = (
    amounts: readonly { unit: string; amount: bigint }[],
  ): string[] => {
    const totals = new Map<string, bigint>();
    for (const amount of amounts) {
      totals.set(amount.unit, (totals.get(amount.unit) ?? 0n) + amount.amount);
    }
    return Array.from(totals, ([unit, amount]) => `${unit}:${amount}`).sort();
  };
  const leftAmounts = aggregate(left.fixedPricingAmounts ?? []);
  const rightAmounts = aggregate(right.fixedPricingAmounts ?? []);
  return (
    leftAmounts.length === rightAmounts.length &&
    leftAmounts.every((value, index) => value === rightAmounts[index])
  );
}

export function resolveEntryPricing(
  entry: RegistryDiffEntry,
  readySources: readonly CardanoV2ReadySource[],
): ParsedAgentPricing {
  // V2 pricing belongs to the registry policy/source model, not the legacy
  // top-level payment type. Free and EVM-only V2 entries report `None`.
  if (isV2RegistryIdentifier(entry.agentIdentifier)) {
    return projectV2AgentPricing(entry, readySources);
  }
  return parseEntryAgentPricing(entry.AgentPricing, entry.agentIdentifier);
}

/**
 * Warns when a V2 entry exposes a purchase-ready source Sokosumi cannot bill.
 *
 * Source-dependent or unusable pricing already projects to UNKNOWN and keeps
 * the agent unavailable. This warning identifies the registry-data defect at
 * ingestion instead of waiting for a hire attempt. Advisory only: the normal
 * pricing projection and availability filters own enforcement.
 */
export function warnOnUnbillableReadyV2Sources(
  entry: RegistryDiffEntry,
  readySources: readonly CardanoV2ReadySource[],
  creditCostUnits: ReadonlySet<string>,
): void {
  if (!isV2RegistryIdentifier(entry.agentIdentifier)) {
    return;
  }
  const network = getEnv().NETWORK;
  for (const source of entry.SupportedPaymentSources ?? []) {
    if (
      source.chain !== "Cardano" ||
      source.network !== network ||
      source.paymentSourceType !== "Web3CardanoV2" ||
      !isCardanoV2SourceReady(
        entry.agentIdentifier,
        source.address,
        readySources,
      )
    ) {
      continue;
    }
    const projected = projectSourcePricing(
      source.pricing,
      entry.agentIdentifier,
    );
    if (projected.pricingType === PricingType.FREE) {
      continue;
    }
    if (
      projected.pricingType !== PricingType.FIXED ||
      !projected.fixedPricingAmounts?.length
    ) {
      console.warn(
        `[sync/agents] Entry ${entry.agentIdentifier} source ${source.sourceIndex} is purchase-ready but has no usable fixed pricing; selecting it strands a seller job`,
      );
      continue;
    }
    const unbillableUnits = projected.fixedPricingAmounts
      .map((amount) => amount.unit)
      .filter((unit) => !creditCostUnits.has(unit));
    if (unbillableUnits.length > 0) {
      console.warn(
        `[sync/agents] Entry ${entry.agentIdentifier} source ${source.sourceIndex} is purchase-ready but prices in units with no CreditCost (${unbillableUnits.join(", ")}); selecting it strands a seller job`,
      );
    }
  }
}

export interface AgentPaymentSourceRow {
  sourceIndex: number;
  chain: string;
  network: string;
  paymentSourceType: string | null;
  address: string;
  payTo: string | null;
  scheme: string | null;
  resource: string | null;
  pricingType: PricingType;
  amounts?: { unit: string; amount: bigint; decimals: number | null }[];
}

export function buildPaymentSourceRows(
  entry: RegistryDiffEntry,
): AgentPaymentSourceRow[] {
  const rows: AgentPaymentSourceRow[] = [];
  const seenSourceIndexes = new Set<number>();
  for (const source of (entry.SupportedPaymentSources ?? []).slice(
    0,
    MAX_PAYMENT_SOURCES,
  )) {
    // Defensive: sourceIndex is unique per agent in our schema; a duplicate
    // from the registry must not turn into a batch-stopping constraint error.
    if (
      !isDatabaseInt(source.sourceIndex) ||
      source.sourceIndex > MAX_PAYMENT_SOURCE_INDEX ||
      seenSourceIndexes.has(source.sourceIndex)
    ) {
      continue;
    }
    seenSourceIndexes.add(source.sourceIndex);

    const projected = projectSourcePricing(
      source.pricing,
      entry.agentIdentifier,
    );
    const row: AgentPaymentSourceRow = {
      sourceIndex: source.sourceIndex,
      chain: source.chain,
      network: source.network,
      paymentSourceType: source.paymentSourceType,
      address:
        source.chain === "Cardano" &&
        source.paymentSourceType === "Web3CardanoV2"
          ? source.address.toLowerCase()
          : source.address,
      payTo: source.payTo,
      scheme: source.scheme,
      resource: source.resource,
      pricingType: projected.pricingType,
    };
    const fixedPricing =
      source.pricing.pricingType === "Fixed" ? source.pricing : null;
    if (projected.fixedPricingAmounts && fixedPricing) {
      // Zip decimals positionally — assets are not guaranteed unique within
      // one source's fixed amounts.
      row.amounts = projected.fixedPricingAmounts.map((amount, index) => ({
        ...amount,
        decimals: fixedPricing.fixed[index]?.decimals ?? null,
      }));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Registry-derived scalar fields, shared by create and update so re-registered
 * agents no longer go stale (the old update branch refreshed only uptime and
 * status).
 */
export function buildRegistryAgentFields(
  entry: RegistryDiffEntry,
  version: RegistryAgentVersion,
) {
  return {
    name: entry.name,
    description: emptyStringToNull(entry.description),
    apiBaseUrl: emptyStringToNull(entry.apiBaseUrl),
    type: convertEntryType(entry.type),
    openApiSpecUrl: emptyStringToNull(entry.openApiSpecUrl),
    x402ResourcesUrl: emptyStringToNull(entry.x402ResourcesUrl),
    metadataVersion: entry.metadataVersion,
    supersededByAgentIdentifier: emptyStringToNull(
      entry.supersededByAgentIdentifier,
    ),
    lastUptimeCheck: entry.lastUptimeCheck,
    uptimeCount: entry.uptimeCount,
    uptimeCheckCount: entry.uptimeCheckCount,
    capabilityName: emptyStringToNull(entry.Capability?.name),
    capabilityVersion: emptyStringToNull(entry.Capability?.version),
    authorName: emptyStringToNull(entry.authorName),
    authorContactEmail: isValidEmail(entry.authorContactEmail)
      ? entry.authorContactEmail
      : null,
    authorContactOther: emptyStringToNull(entry.authorContactOther),
    authorOrganization: emptyStringToNull(entry.authorOrganization),
    image: emptyStringToNull(entry.image),
    status: version.isValid ? convertStatus(entry.status) : AgentStatus.INVALID,
    legalOther: emptyStringToNull(entry.otherLegal),
    legalTerms: emptyStringToNull(entry.termsAndCondition),
    legalPrivacyPolicy: emptyStringToNull(entry.privacyPolicy),
    paymentType: convertPaymentType(entry.paymentType),
  };
}

export function buildPaymentSourcesCreate(rows: AgentPaymentSourceRow[]) {
  return rows.map((row) => ({
    sourceIndex: row.sourceIndex,
    chain: row.chain,
    network: row.network,
    paymentSourceType: row.paymentSourceType,
    address: row.address,
    payTo: row.payTo,
    scheme: row.scheme,
    resource: row.resource,
    pricingType: row.pricingType,
    ...(row.amounts
      ? {
          amounts: {
            createMany: {
              data: row.amounts,
            },
          },
        }
      : {}),
  }));
}

/** Whether two projected pricings are equivalent (no write needed). */
export function isSameAgentPricing(
  current: {
    pricingType: PricingType;
    fixedPricing: { amounts: { unit: string; amount: bigint }[] } | null;
  },
  next: ParsedAgentPricing,
): boolean {
  if (current.pricingType !== next.pricingType) {
    return false;
  }
  const currentAmounts = current.fixedPricing?.amounts ?? [];
  const nextAmounts = next.fixedPricingAmounts ?? [];
  if (currentAmounts.length !== nextAmounts.length) {
    return false;
  }
  // Normalize both sides. Rows ingested before this release stored the
  // registry's unit verbatim, so an ADA price sits as "" while this release
  // projects it as "lovelace" — the same money. Comparing raw would call every
  // such agent repriced and delete/recreate its pricing rows for a spelling
  // change, and V1 registry pricing is immutable, so those would be the only
  // "reprices" the first replay ever reported.
  const toKey = (row: { unit: string; amount: bigint }) =>
    `${normalizeMasumiPaymentUnit(row.unit)}:${row.amount}`;
  const sortedCurrent = currentAmounts.map(toKey).sort();
  const sortedNext = nextAmounts.map(toKey).sort();
  return sortedCurrent.every((value, index) => value === sortedNext[index]);
}
