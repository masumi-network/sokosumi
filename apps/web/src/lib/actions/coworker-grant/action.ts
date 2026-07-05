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
