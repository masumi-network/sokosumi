import { createError } from "evlog";

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
  if (!network) {
    throw createError({
      message: `Unknown Network: ${String(value)}`,
      why: "A caller passed a value that is not a Network",
      fix: `Pass one of ${NETWORKS.join(", ")}`,
    });
  }
  return network;
}

/**
 * Whether Preprod, the Network in this database, is on:
 * `NETWORK_PREPROD_ENABLED`, which Core's startup check allows only while the
 * three schema names are all different and none is `public`. `networkPrisma`
 * refuses Preprod while it is false.
 * Unrelated to the deployment's `NETWORK`: the old Preprod deployment runs with
 * this off.
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
