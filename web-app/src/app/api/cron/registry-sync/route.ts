import { createClient } from "@hey-api/client-next";
import { after, NextResponse } from "next/server";

import { getEnvPublicConfig, getEnvSecrets } from "@/config/env.config";
import { postRegistryEntry } from "@/lib/api/generated/registry";
import prisma from "@/lib/db/prisma";
import { getLock, releaseLock, timeLimitedExecution } from "@/lib/utils";

const LOCK_KEY = "registry-sync";

export async function POST() {
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
      console.info("Syncing took", (timingEnd - timingStart) / 1000, "seconds");
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      releaseLock(lock);
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllEntries() {
  let lastIdentifier: string | undefined = undefined;
  const limit = 20;
  const runningDbUpdates: Promise<void>[] = [];
  const registryClient = createClient({
    baseUrl: getEnvSecrets().REGISTRY_API_URL,
  });
  registryClient.setConfig({
    headers: { token: getEnvSecrets().REGISTRY_API_KEY },
  });
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
            where: { agentIdentifier: entry.agentIdentifier },
            create: {
              agentIdentifier: entry.agentIdentifier,
              onChainName: entry.name,
              onChainDescription: entry.description,
              onChainApiBaseUrl: entry.apiBaseUrl,
              lastUptimeCheck: entry.lastUptimeCheck,
              uptimeCount: entry.uptimeCount,
              uptimeCheckCount: entry.uptimeCheckCount,
              onChainCapabilityName: entry.Capability?.name ?? "",
              onChainCapabilityVersion: entry.Capability?.version ?? "",
              onChainAuthorName: entry.authorName ?? "",
              onChainAuthorContactEmail: entry.authorContactEmail ?? "",
              onChainAuthorContactOther: entry.authorContactOther ?? "",
              onChainImage: entry.image ?? "",
              onChainAuthorOrganization: entry.authorOrganization ?? "",
              showOnFrontPage: false,
              status: entry.status,
              onChainLegalOther: entry.otherLegal ?? "",
              onChainLegalTerms: entry.termsAndCondition ?? "",
              onChainLegalPrivacyPolicy: entry.privacyPolicy ?? "",
              ranking: 0,
              Rating: {
                create: {
                  totalStars: 0,
                  totalRatings: 0,
                },
              },
              Pricing: {
                create: {
                  pricingType: "Fixed",
                  FixedPricing: {
                    create: {
                      Amounts: {
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
              ExampleOutput: {
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
              status: entry.status,
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
