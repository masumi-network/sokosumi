export function isHarvestReportOnly(argv: string[]): boolean {
  return argv.includes("--report-only");
}

export const CREDENTIAL_ISSUER = "local:credential";
export const GOOGLE_ISSUER = "https://accounts.google.com";
export const MICROSOFT_ISSUER_PREFIX = "https://login.microsoftonline.com/";

export interface AccountIdentityInput {
  id: string;
  providerId: string;
  accountId: string;
  userId: string;
  idToken?: string | null;
  refreshToken?: string | null;
}

export interface ReadyAccountIdentity {
  status: "ready";
  id: string;
  issuer: string;
  accountId: string;
  source: "credential" | "google" | "microsoft-id-token" | "synthetic-oauth";
}

export interface UnmappedAccountIdentity {
  status: "unmapped";
  id: string;
  providerId: string;
  accountId: string;
  reason:
    | "microsoft-id-token-missing"
    | "microsoft-oid-missing"
    | "microsoft-issuer-untrusted"
    | "microsoft-id-token-malformed";
}

export type AccountIdentity = ReadyAccountIdentity | UnmappedAccountIdentity;

export interface MicrosoftTokenRefresh {
  idToken?: string | null;
  refreshToken?: string | null;
}

export interface MicrosoftHarvestWrite {
  idToken: string;
  refreshToken: string | null;
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveAccountIdentity(
  row: AccountIdentityInput,
): AccountIdentity {
  if (row.providerId === "credential") {
    return {
      status: "ready",
      id: row.id,
      issuer: CREDENTIAL_ISSUER,
      accountId: row.userId,
      source: "credential",
    };
  }

  if (row.providerId === "google") {
    return {
      status: "ready",
      id: row.id,
      issuer: GOOGLE_ISSUER,
      accountId: row.accountId,
      source: "google",
    };
  }

  if (row.providerId === "microsoft") {
    return resolveMicrosoftIdentity(row);
  }

  return {
    status: "ready",
    id: row.id,
    issuer: `local:oauth:${encodeURIComponent(row.providerId)}`,
    accountId: row.accountId,
    source: "synthetic-oauth",
  };
}

/**
 * Only persist a Microsoft refresh when the new id token is harvest-ready.
 * Keep a rotated refresh_token so 1.6 can still refresh after harvest.
 */
export function applyMicrosoftRefreshToAccount(
  row: AccountIdentityInput,
  tokens: MicrosoftTokenRefresh,
): MicrosoftHarvestWrite | null {
  if (!tokens.idToken) {
    return null;
  }

  const next = resolveAccountIdentity({
    ...row,
    idToken: tokens.idToken,
  });
  if (next.status !== "ready") {
    return null;
  }

  return {
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken ?? row.refreshToken ?? null,
  };
}

export function assertIdentitiesReadyForUniqueIndex(
  identities: AccountIdentity[],
): void {
  const unmapped = identities.filter(
    (identity): identity is UnmappedAccountIdentity =>
      identity.status === "unmapped",
  );
  if (unmapped.length > 0) {
    const sample = unmapped
      .slice(0, 5)
      .map((row) => `${row.id}:${row.reason}`)
      .join(", ");
    throw new Error(
      `unmapped account identities (${unmapped.length}): ${sample}`,
    );
  }

  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const identity of identities) {
    if (identity.status !== "ready") {
      continue;
    }
    const key = `${identity.issuer}\0${identity.accountId}`;
    const previous = seen.get(key);
    if (previous && previous !== identity.id) {
      collisions.push(`${identity.issuer}/${identity.accountId}`);
    }
    seen.set(key, identity.id);
  }

  if (collisions.length > 0) {
    throw new Error(
      `identity collisions (${collisions.length}): ${collisions.slice(0, 5).join(", ")}`,
    );
  }
}

function resolveMicrosoftIdentity(row: AccountIdentityInput): AccountIdentity {
  if (!row.idToken) {
    return {
      status: "unmapped",
      id: row.id,
      providerId: "microsoft",
      accountId: row.accountId,
      reason: "microsoft-id-token-missing",
    };
  }

  const payload = decodeJwtPayload(row.idToken);
  if (!payload) {
    return {
      status: "unmapped",
      id: row.id,
      providerId: "microsoft",
      accountId: row.accountId,
      reason: "microsoft-id-token-malformed",
    };
  }

  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  if (!issuer.startsWith(MICROSOFT_ISSUER_PREFIX)) {
    return {
      status: "unmapped",
      id: row.id,
      providerId: "microsoft",
      accountId: row.accountId,
      reason: "microsoft-issuer-untrusted",
    };
  }

  const oid = typeof payload.oid === "string" ? payload.oid.trim() : "";
  if (!oid) {
    return {
      status: "unmapped",
      id: row.id,
      providerId: "microsoft",
      accountId: row.accountId,
      reason: "microsoft-oid-missing",
    };
  }

  return {
    status: "ready",
    id: row.id,
    issuer,
    accountId: oid,
    source: "microsoft-id-token",
  };
}
