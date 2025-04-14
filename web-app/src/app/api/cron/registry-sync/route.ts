import { after, NextResponse } from "next/server";

import { getEnvPublicConfig, getEnvSecrets } from "@/config/env.config";
import { postRegistryEntry } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { compareApiKeys } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { getLock, releaseLock, timeLimitedExecution } from "@/lib/utils";
import { PricingType } from "@/prisma/generated/client";

const LOCK_KEY = "registry-sync";

export async function POST(request: Request) {
  const headerApiKey = request.headers.get("admin-api-key");
  if (!headerApiKey) {
    return NextResponse.json(
      { message: "No api key provided" },
      { status: 401 },
    );
  }
  if (compareApiKeys(headerApiKey) !== true) {
    return NextResponse.json({ message: "Invalid api key" }, { status: 401 });
  }
  // Start a transaction to ensure atomicity
  const lock = await getLock(LOCK_KEY);

  if (!lock) {
    return NextResponse.json(
      { message: "Syncing already in progress" },
      { status: 429 },
    );
  }

  after(async () => {
    try {
      const timingStart = Date.now();
      await timeLimitedExecution(
        syncAllEntries,
        //give some buffer to unlock the lock before the timeout
        getEnvSecrets().LOCK_TIMEOUT - 1000 * 25,
      );
      const timingEnd = Date.now();
      console.info(
        "Registry sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      releaseLock(lock);
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

const convertStatus = (
  status: "Online" | "Offline" | "Deregistered" | "Invalid",
) => {
  return status.toUpperCase() as
    | "ONLINE"
    | "OFFLINE"
    | "DEREGISTERED"
    | "INVALID";
};

async function syncAllEntries() {
  let lastIdentifier: string | undefined = undefined;
  const limit = 20;
  const runningDbUpdates: Promise<void>[] = [];
  const registryClient = getRegistryClient();
  while (true) {
    const response = await postRegistryEntry({
      client: registryClient,
      body: {
        network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        limit,
        cursorId: lastIdentifier,
        filter: {
          status: ["Online", "Offline", "Deregistered", "Invalid"],
        },
      },
    });
    if (
      !response.data ||
      response.error ||
      !response.data.data ||
      response.response.status !== 200
    ) {
      console.error("Error in sync operation:", response.error);
      break;
    }
    const entries = response.data.data.entries;

    //add all updates to the queue and start them in parallel
    runningDbUpdates.push(
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
                connectOrCreate: entry.tags?.map((tag) => {
                  return {
                    where: { name: tag },
                    create: { name: tag },
                  };
                }),
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
              pricing: {
                create: {
                  pricingType: PricingType.FIXED,
                  fixedPricing: {
                    create: {
                      amounts: {
                        createMany: {
                          data: entry.AgentPricing.FixedPricing.Amounts.map(
                            (amount) => ({
                              amount: BigInt(amount.amount),
                              unit: amount.unit,
                            }),
                          ),
                        },
                      },
                    },
                  },
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
              //No update as the metadata will not change
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

    const lastElement =
      response.data.data.entries[response.data.data.entries.length - 1];

    //TODO: figure out why the automatic type inference breaks here if not explicitly casted
    lastIdentifier = lastElement.id as string;
  }
  await Promise.all(runningDbUpdates);
}
