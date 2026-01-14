import { Network } from "@sokosumi/database";

import { getEnvPublicConfig } from "@/config/env.public";

/**
 * Converts NEXT_PUBLIC_NETWORK environment variable to Database.Network enum
 *
 * Maps:
 * - "Preprod" -> Network.PREPROD
 * - "Mainnet" -> Network.MAINNET
 *
 * @returns The Network enum value corresponding to NEXT_PUBLIC_NETWORK
 */
export function getNetworkFromEnv(): Network {
  const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK;

  switch (network) {
    case "Preprod":
      return Network.PREPROD;
    case "Mainnet":
      return Network.MAINNET;
    default:
      // TypeScript should catch this, but provide a runtime fallback
      throw new Error(`Unsupported network: ${network}`);
  }
}
