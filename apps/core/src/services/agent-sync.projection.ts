import { z } from "@hono/zod-openapi";
import {
  AgentEntryType,
  AgentStatus,
  PaymentType,
  PricingType,
} from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  parseVersionedAgentIdentifier,
} from "@sokosumi/masumi";
import type { PostRegistryDiffResponse } from "@sokosumi/masumi/clients";

import { getEnv } from "@/config/env";
import {
  type CardanoV2ReadySource,
  isCardanoV2SourceReady,
  normalizeMasumiPaymentUnit,
} from "@/helpers/agent";

export function isValidEmail(
  email: string | null | undefined,
): email is string {
  if (!email) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function emptyStringToNull(
  value: string | null | undefined,
): string | null {
  if (!value || value === "") {
    return null;
  }

  return value;
}

export function convertStatus(
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

export function convertPaymentType(
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
      Amounts: z.array(z.object({ amount: z.string(), unit: z.string() })),
    })
    .optional(),
});

export interface ParsedAgentPricing {
  pricingType: PricingType;
  fixedPricingAmounts?: { amount: bigint; unit: string }[];
}

export function parseEntryAgentPricing(
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
      // exposing malformed registry pricing as a valid fixed-price agent.
      // BigInt() throws on non-numeric strings, so it must stay guarded.
      try {
        const isValidFixedPricing = amounts.every(
          (amount) => BigInt(amount.amount) > 0,
        );
        if (!isValidFixedPricing || amounts.length === 0) {
          return {
            pricingType: PricingType.UNKNOWN,
          };
        }

        return {
          pricingType: PricingType.FIXED,
          fixedPricingAmounts: amounts.map((amount) => ({
            amount: BigInt(amount.amount),
            unit: normalizeMasumiPaymentUnit(amount.unit),
          })),
        };
      } catch {
        console.warn(
          `[sync/agents] Non-numeric fixed pricing amount for entry ${agentIdentifier}; storing as UNKNOWN (agent stays unavailable)`,
        );
        return {
          pricingType: PricingType.UNKNOWN,
        };
      }
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
export type RegistryPaymentSource =
  RegistryDiffEntry["SupportedPaymentSources"][number];

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
      try {
        const amounts = pricing.fixed.map((fixedAmount) => ({
          unit: normalizeMasumiPaymentUnit(fixedAmount.asset),
          amount: BigInt(fixedAmount.amount),
        }));
        if (amounts.length === 0 || amounts.some((row) => row.amount <= 0n)) {
          return { pricingType: PricingType.UNKNOWN };
        }
        return {
          pricingType: PricingType.FIXED,
          fixedPricingAmounts: amounts,
        };
      } catch {
        console.warn(
          `[sync/agents] Non-numeric source pricing amount for entry ${agentIdentifier}; storing as UNKNOWN`,
        );
        return { pricingType: PricingType.UNKNOWN };
      }
    }
    case "Free":
      return { pricingType: PricingType.FREE };
    default:
      return { pricingType: PricingType.UNKNOWN };
  }
}

/**
 * V2 entries price each payment source independently. The agent-level pricing
 * (credits math, availability) comes from the Cardano V2 source matching this
 * deployment's network; no match means the agent is not purchasable here.
 * Among matching sources, one that is currently purchase-ready is preferred so
 * the displayed price stays consistent with the source a hire can actually
 * use (readiness is refreshed just before registry sync in the same cron; a
 * readiness flip between syncs can still leave the stored price stale until
 * the entry next changes).
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
  const source =
    matching.find((candidate) =>
      isCardanoV2SourceReady(
        entry.agentIdentifier,
        candidate.address,
        readySources,
      ),
    ) ?? matching[0];
  if (!source) {
    return { pricingType: PricingType.UNKNOWN };
  }
  return projectSourcePricing(source.pricing, entry.agentIdentifier);
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
 * The agent-level price comes from ONE preferred source, so the availability
 * filter and the displayed cost only ever validate that source's units. A
 * seller may still select any other purchase-ready source at start_job — and
 * if its units have no CreditCost row, or it carries no fixed pricing, the
 * hire fails only AFTER start_job, stranding a seller-side job (see
 * reportOrphanedSellerJob in helpers/job.ts).
 *
 * That is a registry-data defect, so surface it at ingestion where it is
 * detectable once per sync rather than once per stranded hire. Advisory only:
 * it never blocks the upsert, since the entry is still valid for every other
 * source it offers.
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
  for (const source of entry.SupportedPaymentSources ?? []) {
    // Defensive: sourceIndex is unique per agent in our schema; a duplicate
    // from the registry must not turn into a batch-stopping constraint error.
    if (seenSourceIndexes.has(source.sourceIndex)) {
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
      address: source.address,
      payTo: source.payTo,
      scheme: source.scheme,
      resource: source.resource,
      pricingType: projected.pricingType,
    };
    if (
      projected.fixedPricingAmounts &&
      source.pricing.pricingType === "Fixed"
    ) {
      // Zip decimals positionally — assets are not guaranteed unique within
      // one source's fixed amounts.
      row.amounts = source.pricing.fixed.map((fixedAmount, index) => ({
        unit: normalizeMasumiPaymentUnit(fixedAmount.asset),
        amount:
          projected.fixedPricingAmounts?.[index]?.amount ??
          BigInt(fixedAmount.amount),
        decimals: fixedAmount.decimals ?? null,
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
    supersededByAgentIdentifier: entry.supersededByAgentIdentifier,
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
  const toKey = (row: { unit: string; amount: bigint }) =>
    `${row.unit}:${row.amount}`;
  const sortedCurrent = currentAmounts.map(toKey).sort();
  const sortedNext = nextAmounts.map(toKey).sort();
  return sortedCurrent.every((value, index) => value === sortedNext[index]);
}
