import { createClient } from "@hey-api/client-next";
import { after, NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.config";
import { postRegistryEntry } from "@/lib/api/generated/registry";
import prisma from "@/lib/db/prisma";

const LOCK_KEY = "registry-sync";

async function timeLimitedExecution<T>(
  fn: () => Promise<T>,
  timeout: number,
): Promise<T> {
  const result = await Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeout),
    ),
  ]);
  if (result instanceof Error) {
    throw result;
  }
  return result as T;
}

export async function POST() {
  // Start a transaction to ensure atomicity
  const lock = await prisma.$transaction(async (tx) => {
    // Example: Try to acquire a lock on a specific agent
    // Using pessimistic locking with 'FOR UPDATE'
    const lock = await tx.lock.findFirst({
      where: {
        key: LOCK_KEY,
      },
    });

    if (!lock) {
      return await tx.lock.create({
        data: {
          key: LOCK_KEY,
          lockedBy: getEnvSecrets().INSTANCE_ID,
          lockedAt: new Date(),
          isLocked: true,
        },
      });
    }

    if (lock.isLocked) {
      if (
        lock.lockedAt &&
        lock.lockedAt < new Date(Date.now() - getEnvSecrets().LOCK_TIMEOUT)
      ) {
        //TODO: better logging
        console.warn(
          "Lock timeout reached, will release key",
          LOCK_KEY,
          "last updated at: ",
          lock.updatedAt,
          " by instance: ",
          lock.lockedBy,
        );
        return await tx.lock.update({
          where: { id: lock.id },
          data: {
            lockedBy: getEnvSecrets().INSTANCE_ID,
            lockedAt: new Date(),
            isLocked: true,
          },
        });
      }
      return null;
    }
    return await tx.lock.update({
      where: { id: lock.id },
      data: {
        lockedBy: getEnvSecrets().INSTANCE_ID,
        lockedAt: new Date(),
        isLocked: true,
      },
    });
  });
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
        getEnvSecrets().LOCK_TIMEOUT - 1000,
      );

      const timingEnd = Date.now();
      console.log("Syncing took", (timingEnd - timingStart) / 1000, "seconds");
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      const updatedLock = await prisma.lock.update({
        where: { key: LOCK_KEY, updatedAt: lock.updatedAt },
        data: { isLocked: false, lockedBy: null, lockedAt: null },
      });
      if (!updatedLock) {
        console.error(
          "Lock changed while locked, will not release. Expected key",
          LOCK_KEY,
          "to be last updated at: ",
          lock.updatedAt,
        );
      }
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
        network: "Preprod",
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
            },
            update: {
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
