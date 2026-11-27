import type { NetworkScope } from "@/lib/db/network-scope";

export async function getAgentEndpoint(scope: NetworkScope, id: string) {
  return await scope.networkDb.agent.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      blockchainIdentifier: true,
      apiBaseUrl: true,
      metadataOverride: {
        select: {
          apiBaseUrl: true,
        },
      },
    },
  });
}
