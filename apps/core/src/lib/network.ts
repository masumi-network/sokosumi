import type { TableNetwork } from "@sokosumi/database/sql-tables";
import { hasAdminRole } from "@sokosumi/utils";
import { createError } from "evlog";

import { getEnv } from "@/config/env";

/**
 * A Masumi Network. Every Network has its own database schema and its own keys.
 * Lowercase, as its schema names and key prefixes are; the deployment's
 * `NETWORK` (`"Mainnet" | "Preprod"`) is a different value and goes away.
 * The same names raw SQL takes (`netTable`).
 */
export type Network = TableNetwork;

// Detached Soko Bot work runs on Mainnet until tickets 24 and 30 carry provenance.
export const DETACHED_SOKO_BOT_NETWORK = "mainnet" satisfies Network;

// The job sync runs on Mainnet until ticket 23 gives it the Job's Network.
export const JOB_SYNC_NETWORK = "mainnet" satisfies Network;

export const NETWORKS = [
  "mainnet",
  "preprod",
] as const satisfies readonly Network[];
// And the reverse: a Network the package adds and this list misses fails here.
const _everyNetworkListed: Exclude<
  Network,
  (typeof NETWORKS)[number]
> extends never
  ? true
  : never = true;

/** The Network a payload names in the spelling of the deployment's `NETWORK` (`PaymentSource.network`). */
export const NETWORK_BY_NAME = {
  Mainnet: "mainnet",
  Preprod: "preprod",
} as const satisfies Record<string, Network>;

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
 * three schema names are all different and none is `public`. `requireNetworkOn`
 * refuses Preprod while it is false.
 * Unrelated to the deployment's `NETWORK`: the old Preprod deployment runs with
 * this off.
 */
export function isPreprodOn(): boolean {
  return getEnv().NETWORK_PREPROD_ENABLED;
}

/**
 * Whether a user may use Preprod in one Workspace: the one copy of the rule.
 * Never while Preprod is off. A platform admin always; otherwise the user's
 * flag decides in their personal Workspace and the Organization's flag in an
 * Organization Workspace. Reads nothing: the caller brings the flags it
 * loaded, and has established that the Workspace is the user's own or that
 * they are a member of its Organization.
 */
export function canUsePreprodInWorkspace(
  user: { preprodEnabled?: boolean },
  role: string | null | undefined,
  /** `organization` is null for the personal Workspace. */
  workspace: { organization: { preprodEnabled?: boolean } | null },
): boolean {
  if (!isPreprodOn()) return false;
  if (hasAdminRole(role)) return true;
  return (workspace.organization ?? user).preprodEnabled === true;
}

export function networksThatAreOn(): readonly Network[] {
  return isPreprodOn() ? NETWORKS : ["mainnet"];
}

/**
 * Returns `value` as a Network that is on, or throws: Preprod is refused while
 * it is off, because on today's layout its schema is Mainnet's.
 */
export function requireNetworkOn(value: unknown): Network {
  const network = requireNetwork(value);
  if (network === "preprod" && !isPreprodOn()) {
    throw createError({
      message: "Preprod is off: NETWORK_PREPROD_ENABLED is not true",
      why: "A caller asked for Preprod while Preprod is off",
      fix: "Check isPreprodOn() before asking for Preprod",
    });
  }
  return network;
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
