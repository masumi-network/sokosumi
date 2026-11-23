export const NETWORKS = ["mainnet", "preprod"] as const;

/**
 * A Masumi Network. Every Network has its own database schema and its own keys.
 * Lowercase, as its schema names and key prefixes are; the deployment's
 * `NETWORK` (`"Mainnet" | "Preprod"`) is a different value and goes away.
 */
export type Network = (typeof NETWORKS)[number];

/**
 * The lock, cursor or cache key `name` of one Network.
 *
 * shortcut: Mainnet keeps today's unprefixed key until the move renames the
 * stored keys to `mainnet:`; switch Mainnet to the prefix in the same change.
 */
export function networkKey(network: Network, name: string): string {
  return network === "mainnet" ? name : `${network}:${name}`;
}
