import type { Network } from "./network";

export const USER_API_KEY_PREFIXES = {
  mainnet: "soko_mainnet_",
  preprod: "soko_preprod_",
} as const satisfies Record<Network, string>;

export function networkFromUserApiKeyPrefix(prefix: string | null): Network {
  return prefix === USER_API_KEY_PREFIXES.preprod ? "preprod" : "mainnet";
}
