"use server";

import type { ActionError } from "@/lib/actions/errors";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import type {
  CoworkerGrant,
  CoworkerGrantStatus,
} from "@/lib/clients/generated/core";

export async function listCoworkerGrantsAction(): Promise<
  { ok: true; data: CoworkerGrant[] } | { ok: false; error: ActionError }
> {
  try {
    const grants = await coreClient.getCoworkerGrants();
    return { ok: true, data: grants };
  } catch (error) {
    return { ok: false, error: toCoreApiActionError(error) };
  }
}

export async function resolveCoworkerGrantAction(
  grantId: string,
  status: Extract<CoworkerGrantStatus, "GRANTED" | "DENIED" | "REVOKED">,
): Promise<
  { ok: true; data: CoworkerGrant } | { ok: false; error: ActionError }
> {
  try {
    const grant = await coreClient.resolveCoworkerGrant(grantId, status);
    return { ok: true, data: grant };
  } catch (error) {
    return { ok: false, error: toCoreApiActionError(error) };
  }
}

/**
 * Grants a coworker a scope by resolving the user's matching grant row —
 * used by "always allow" affordances that reference a coworker rather than
 * a grant id (e.g. the task acceptance banner).
 */
export async function grantCoworkerScopeAction(
  coworkerId: string,
  scope: CoworkerGrant["scope"],
): Promise<
  { ok: true; data: CoworkerGrant | null } | { ok: false; error: ActionError }
> {
  try {
    const grants = await coreClient.getCoworkerGrants();
    const grant = grants.find(
      (g) => g.coworker.id === coworkerId && g.scope === scope,
    );
    if (!grant) {
      return { ok: true, data: null };
    }
    if (grant.status === "GRANTED") {
      return { ok: true, data: grant };
    }
    const resolved = await coreClient.resolveCoworkerGrant(grant.id, "GRANTED");
    return { ok: true, data: resolved };
  } catch (error) {
    return { ok: false, error: toCoreApiActionError(error) };
  }
}
