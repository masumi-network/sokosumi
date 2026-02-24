import { AgentStatus, PaymentType, PricingType } from "@sokosumi/database";

import { registryClient } from "@/clients/masumi-registry.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import { getAgentDescription } from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

const AGENT_SUMMARY_SYNC_LIMIT = 20;

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
  status: "Online" | "Offline" | "Deregistered" | "Invalid",
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
  }
}

function convertPaymentType(paymentType: "Web3CardanoV1" | "None" | unknown) {
  switch (paymentType) {
    case "Web3CardanoV1":
      return PaymentType.WEB3_CARDANO_V1;
    case "None":
      return PaymentType.NONE;
    default:
      return PaymentType.UNKNOWN;
  }
}

function parseEntryAgentPricing(pricing: {
  pricingType: string;
  FixedPricing?: {
    Amounts: {
      amount: string;
      unit: string;
    }[];
  };
}): {
  pricingType: PricingType;
  fixedPricingAmounts?: { amount: bigint; unit: string }[];
} {
  switch (pricing.pricingType) {
    case "Fixed": {
      const amounts = pricing.FixedPricing?.Amounts ?? [];
      const isValidFixedPricing = amounts.every(
        (amount) => BigInt(amount.amount) > 0,
      );

      // Intentionally treat empty/invalid fixed pricing as unknown to avoid
      // exposing malformed registry pricing as a valid fixed-price agent.
      if (!isValidFixedPricing || amounts.length === 0) {
        return {
          pricingType: PricingType.UNKNOWN,
        };
      }

      return {
        pricingType: PricingType.FIXED,
        fixedPricingAmounts: amounts.map((amount) => ({
          amount: BigInt(amount.amount),
          unit: amount.unit,
        })),
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

async function syncRegistryAgents(metadataKey: string): Promise<void> {
  const metadata = await prisma.syncMetadata.findUnique({
    where: {
      key: metadataKey,
    },
  });
  const lastSyncedAt = metadata?.lastSyncedAt ?? new Date(0);
  const cursorId = metadata?.cursorId ?? null;

  const entriesResult = await registryClient.getAgentsDiff(
    lastSyncedAt,
    cursorId,
    50,
  );
  if (entriesResult.isErr()) {
    console.error("Error in diff sync operation:", entriesResult.error);
    return;
  }

  const entries = entriesResult.value;
  if (entries.length === 0) {
    console.info("No entries to sync");
    return;
  }

  const tags = Array.from(
    new Set(entries.map((entry) => entry.tags ?? []).flat()),
  );

  await Promise.all(
    tags.map(async (tag) => {
      await prisma.tag.upsert({
        where: {
          name: tag,
        },
        create: {
          name: tag,
        },
        update: {},
      });
    }),
  );

  await Promise.all(
    entries.map(async (entry) => {
      const { pricingType, fixedPricingAmounts } = parseEntryAgentPricing(
        entry.AgentPricing,
      );

      await prisma.agent.upsert({
        where: {
          blockchainIdentifier: entry.agentIdentifier,
        },
        create: {
          blockchainIdentifier: entry.agentIdentifier,
          name: entry.name,
          description: emptyStringToNull(entry.description),
          apiBaseUrl: entry.apiBaseUrl,
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
          image: emptyStringToNull(entry.image),
          tags: {
            connect: entry.tags?.map((tag) => ({
              name: tag,
            })),
          },
          authorOrganization: emptyStringToNull(entry.authorOrganization),
          isShown: getEnv().SHOW_AGENTS_BY_DEFAULT,
          status: convertStatus(entry.status),
          legalOther: emptyStringToNull(entry.otherLegal),
          legalTerms: emptyStringToNull(entry.termsAndCondition),
          legalPrivacyPolicy: emptyStringToNull(entry.privacyPolicy),
          paymentType: convertPaymentType(entry.paymentType),
          pricing: {
            create: {
              pricingType,
              ...(fixedPricingAmounts
                ? {
                    fixedPricing: {
                      create: {
                        amounts: {
                          createMany: {
                            data: fixedPricingAmounts,
                          },
                        },
                      },
                    },
                  }
                : {}),
            },
          },
          exampleOutput: {
            createMany: {
              data: entry.ExampleOutput.map((example) => ({
                mimeType: example.mimeType,
                name: example.name,
                url: example.url,
              })),
            },
          },
        },
        update: {
          lastUptimeCheck: entry.lastUptimeCheck,
          uptimeCount: entry.uptimeCount,
          uptimeCheckCount: entry.uptimeCheckCount,
          status: convertStatus(entry.status),
        },
      });
    }),
  );

  const lastEntry = entries[entries.length - 1];
  await prisma.syncMetadata.upsert({
    where: {
      key: metadataKey,
    },
    create: {
      key: metadataKey,
      cursorId: lastEntry.id,
      lastSyncedAt: new Date(lastEntry.statusUpdatedAt),
    },
    update: {
      cursorId: lastEntry.id,
      lastSyncedAt: new Date(lastEntry.statusUpdatedAt),
    },
  });
}

async function syncAgentSummaries(): Promise<void> {
  const agentsWithoutSummary = await prisma.agent.findMany({
    where: {
      status: AgentStatus.ONLINE,
      isShown: true,
      summary: null,
      OR: [
        { description: { not: null } },
        { overrideDescription: { not: null } },
      ],
    },
    take: AGENT_SUMMARY_SYNC_LIMIT,
  });

  for (const agent of agentsWithoutSummary) {
    const description = getAgentDescription(agent);
    if (!description) {
      continue;
    }

    try {
      const summary = await openrouterClient.generateAgentSummary(description);
      if (!summary) {
        continue;
      }

      await prisma.agent.update({
        where: {
          id: agent.id,
        },
        data: {
          summary,
        },
      });
    } catch (error) {
      console.error(`Failed to generate summary for agent ${agent.id}:`, error);
    }
  }
}

export const agentSyncService = {
  syncRegistryAgents,
  syncAgentSummaries,
};
