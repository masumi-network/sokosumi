import { after, NextResponse } from "next/server";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { registryClient } from "@/lib/clients/masumi-registry.client";
import { lockRepository, prisma } from "@/lib/db/repositories";
import { lockService } from "@/lib/services";
import {
  AgentStatus,
  Lock,
  PaymentType,
  PricingType,
} from "@/prisma/generated/client";

const LOCK_KEY = "agents-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await agentSync();
}

async function agentSync() {
  // Start a transaction to ensure atomicity
  let lock: Lock;
  try {
    lock = await lockService.acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      return NextResponse.json(
        { message: "Syncing already in progress" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: "Failed to acquire lock" },
      { status: 500 },
    );
  }

  after(async () => {
    try {
      const timingStart = Date.now();
      await pTimeout(syncAllEntries(), {
        milliseconds:
          //give some buffer to unlock the lock before the timeout
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info(
        "Registry sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      try {
        await lockRepository.unlockByKey(lock.key);
      } catch (error) {
        console.error("Failed to unlock lock:", error);
      }
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

const convertStatus = (
  status: "Online" | "Offline" | "Deregistered" | "Invalid",
) => {
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
};

const convertPricingType = (pricingType: "Fixed" | "Free" | unknown) => {
  switch (pricingType) {
    case "Fixed":
      return PricingType.FIXED;
    case "Free":
      return PricingType.FREE;
    default:
      return PricingType.UNKNOWN;
  }
};

const convertPaymentType = (
  paymentType: "Web3CardanoV1" | "None" | unknown,
) => {
  switch (paymentType) {
    case "Web3CardanoV1":
      return PaymentType.WEB3_CARDANO_V1;
    case "None":
      return PaymentType.NONE;
    default:
      return PaymentType.UNKNOWN;
  }
};

async function syncAllEntries() {
  let lastIdentifier: string | undefined = undefined;
  const runningAgentsUpdates: Promise<void>[] = [];
  const runningTagsUpdates: Promise<void>[] = [];
  const limit = 20;
  while (true) {
    const entriesResult = await registryClient.getAgents(lastIdentifier, limit);
    if (!entriesResult.ok) {
      console.error("Error in sync operation:", entriesResult.error);
      return;
    }
    const entries = entriesResult.data;

    // add all tags to the database
    const tags = Array.from(
      new Set(entries.map((entry) => entry.tags ?? []).flat()),
    );
    runningTagsUpdates.push(
      ...tags.map(async (tag) => {
        await prisma.tag.upsert({
          where: { name: tag },
          create: { name: tag },
          update: {},
        });
      }),
    );
    await Promise.all(runningTagsUpdates);

    // add all updates to the queue and start them in parallel
    runningAgentsUpdates.push(
      ...entries.map(async (entry) => {
        const updateDbEntry = async () => {
          await prisma.agent.upsert({
            where: { blockchainIdentifier: entry.agentIdentifier },
            create: {
              blockchainIdentifier: entry.agentIdentifier,
              name: entry.name,
              description: entry.description,
              apiBaseUrl: entry.apiBaseUrl,
              lastUptimeCheck: entry.lastUptimeCheck,
              uptimeCount: entry.uptimeCount,
              uptimeCheckCount: entry.uptimeCheckCount,
              capabilityName: entry.Capability?.name ?? "",
              capabilityVersion: entry.Capability?.version ?? "",
              authorName: entry.authorName ?? "",
              authorContactEmail: entry.authorContactEmail ?? "",
              authorContactOther: entry.authorContactOther ?? "",
              image: entry.image ?? "",
              tags: {
                connect: entry.tags?.map((tag) => ({ name: tag })),
              },
              authorOrganization: entry.authorOrganization ?? "",
              isShown: getEnvSecrets().SHOW_AGENTS_BY_DEFAULT,
              status: convertStatus(entry.status),
              legalOther: entry.otherLegal ?? "",
              legalTerms: entry.termsAndCondition ?? "",
              legalPrivacyPolicy: entry.privacyPolicy ?? "",
              rating: {
                create: {
                  totalStars: 0,
                  totalRatings: 0,
                },
              },
              paymentType: convertPaymentType(entry.paymentType),
              pricing: {
                create: {
                  pricingType: convertPricingType(
                    entry.AgentPricing.pricingType,
                  ),
                  ...(entry.AgentPricing.pricingType === "Fixed" && {
                    fixedPricing: {
                      create: {
                        amounts: {
                          createMany: {
                            data: entry.AgentPricing.FixedPricing?.Amounts.map(
                              (amount) => ({
                                amount: BigInt(amount.amount),
                                unit: amount.unit,
                              }),
                            ),
                          },
                        },
                      },
                    },
                  }),
                },
              },
              exampleOutput: {
                createMany: {
                  data: entry.ExampleOutput.map((example) => {
                    return {
                      mimeType: example.mimeType,
                      name: example.name,
                      url: example.url,
                    };
                  }),
                },
              },
            },
            update: {
              // No update as the metadata will not change
              lastUptimeCheck: entry.lastUptimeCheck,
              uptimeCount: entry.uptimeCount,
              uptimeCheckCount: entry.uptimeCheckCount,
              status: convertStatus(entry.status),
            },
          });
        };
        //start them immediately
        return updateDbEntry();
      }),
    );
    if (entries.length < limit) {
      break;
    }

    const lastElement = entries.at(-1);
    lastIdentifier = lastElement?.id;
  }
  await Promise.all(runningAgentsUpdates);
}
