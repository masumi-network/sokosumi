import { notFound } from "@/helpers/error";
import { hashApiKey } from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import {
  generateOrchestratorApiKeyToken,
  ORCHESTRATOR_API_KEY_START_LENGTH,
} from "@/lib/orchestrator-api-key";

export async function createOrchestratorApiKeyRecord(params: {
  orchestratorId: string;
  name: string | null | undefined;
  expiresAt: string | null | undefined;
}) {
  const token = generateOrchestratorApiKeyToken();
  const keyHash = await hashApiKey(token);
  const keyStart = token.slice(0, ORCHESTRATOR_API_KEY_START_LENGTH);

  const apiKey = await prisma.$transaction(async (tx) => {
    const activeCount = await tx.orchestrator.updateMany({
      where: {
        id: params.orchestratorId,
        archivedAt: null,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    if (activeCount.count === 0) {
      throw notFound("Orchestrator not found");
    }

    return await tx.orchestratorApiKey.create({
      data: {
        orchestratorId: params.orchestratorId,
        name: params.name ?? null,
        keyHash,
        keyStart,
        expiresAt:
          params.expiresAt === undefined || params.expiresAt === null
            ? null
            : new Date(params.expiresAt),
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        expiresAt: true,
      },
    });
  });

  return {
    id: apiKey.id,
    token,
    name: apiKey.name,
    expiresAt: apiKey.expiresAt,
  };
}

export const orchestratorApiKeySelect = {
  id: true,
  orchestratorId: true,
  name: true,
  keyStart: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
