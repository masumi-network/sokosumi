import type { Coworker } from "@sokosumi/core-client";
import { unstable_rethrow } from "next/navigation";
import { developerCoworkerService } from "@/lib/services/developer-coworker.service";

import {
  type CoworkerApiKeyRow,
  DeveloperCoworkerApiKeys,
} from "./developer-coworker-api-keys";

interface DeveloperCoworkerApiKeysSectionProps {
  coworker: Coworker;
}

/**
 * Runtime keys of a coworker the caller manages (vendor admin or assigned
 * developer, the same people Core lets manage keys). Replacing a key is
 * create, switch the agent, then revoke: no downtime.
 */
export async function DeveloperCoworkerApiKeysSection({
  coworker,
}: DeveloperCoworkerApiKeysSectionProps) {
  let rows: CoworkerApiKeyRow[] = [];
  let loadFailed = false;
  try {
    const keys = await developerCoworkerService.listApiKeys(coworker.id);
    const now = Date.now();
    rows = keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyStart: key.keyStart,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      status: key.revokedAt
        ? "revoked"
        : key.expiresAt && key.expiresAt.getTime() <= now
          ? "expired"
          : "active",
    }));
  } catch (error) {
    // Core turns a 401 into a sign-in redirect; let it through.
    unstable_rethrow(error);
    console.error("Failed to load coworker API keys", error);
    loadFailed = true;
  }

  return (
    <DeveloperCoworkerApiKeys
      coworkerId={coworker.id}
      rows={rows}
      loadFailed={loadFailed}
    />
  );
}
