import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";

/**
 * Last New post accounts, per workspace and project, in this browser.
 * Connection ids only — never tokens or handles.
 */
export const COMPOSER_ACCOUNTS_STORAGE_PREFIX =
  "sokosumi.social-composer.accounts.v1";

export function composerAccountsStorageKey(
  organizationId: string | null,
  projectId: string,
): string {
  return `${COMPOSER_ACCOUNTS_STORAGE_PREFIX}:${organizationId ?? ""}:${projectId}`;
}

function parseConnectionIds(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    if (!parsed.every((id) => typeof id === "string" && id.length > 0)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readRememberedComposerAccounts(
  organizationId: string | null,
  projectId: string,
): string[] | null {
  return readStoredPreference(
    composerAccountsStorageKey(organizationId, projectId),
    parseConnectionIds,
  );
}

export function writeRememberedComposerAccounts(
  organizationId: string | null,
  projectId: string,
  connectionIds: string[],
): void {
  if (connectionIds.length === 0) {
    return;
  }
  writeStoredPreference(
    composerAccountsStorageKey(organizationId, projectId),
    JSON.stringify(connectionIds),
  );
}

/** Stored ids that are still connected, else the first account. */
export function initialCreateConnectionIds(
  connections: readonly { id: string; status: string }[],
  remembered: string[] | null,
): string[] {
  const stillConnected =
    remembered?.filter((id) =>
      connections.some(
        (connection) => connection.id === id && connection.status === "active",
      ),
    ) ?? [];
  if (stillConnected.length > 0) {
    return stillConnected;
  }
  const first = connections[0]?.id;
  return first ? [first] : [];
}
