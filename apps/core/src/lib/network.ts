import { getEnv } from "@/config/env";

export const NETWORKS = ["mainnet", "preprod"] as const;

/**
 * A Masumi Network. Every Network has its own database schema and its own keys.
 * Lowercase, as its schema names and key prefixes are; the deployment's
 * `NETWORK` (`"Mainnet" | "Preprod"`) is a different value and goes away.
 */
export type Network = (typeof NETWORKS)[number];

/**
 * Returns `value` as a Network, or throws. A missing or unknown Network is an
 * error, never a default: a value that slipped past the types must not reach
 * Mainnet's schema or keys.
 */
export function requireNetwork(value: unknown): Network {
  const network = NETWORKS.find((candidate) => candidate === value);
  if (!network) throw new Error(`Unknown Network: ${String(value)}`);
  return network;
}

/**
 * Whether Preprod is on: `NETWORK_PREPROD_ENABLED`, which Core's startup check
 * allows only while the three schema names differ. Every Preprod entry point
 * (requests, crons, webhooks, background work, the Web switch) asks this, and
 * does nothing for Preprod while it is false.
 */
export function isPreprodOn(): boolean {
  return getEnv().NETWORK_PREPROD_ENABLED;
}

/**
 * The lock, cursor or cache key `name` of one Network.
 *
 * shortcut: Mainnet keeps today's unprefixed key until the move renames the
 * stored keys to `mainnet:`; switch Mainnet to the prefix in the same change.
 */
export function networkKey(network: Network, name: string): string {
  return requireNetwork(network) === "mainnet" ? name : `${network}:${name}`;
}
