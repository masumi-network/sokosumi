import { cookies } from "next/headers";

/** Capability token from `/join/[token]` so `/setup` can recover mid-flow. */
export const PENDING_ORGANIZATION_JOIN_COOKIE_NAME =
  "sokosumi_pending_org_join";

export function isUsableJoinToken(token: string): boolean {
  return token.length > 0 && token.length <= 256 && !/\s/.test(token);
}

export function joinTokenFromJoinPath(pathname: string): string | null {
  if (!pathname.startsWith("/join/")) {
    return null;
  }
  const raw = pathname.slice("/join/".length).split("/")[0] ?? "";
  let token = raw;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isUsableJoinToken(token) ? token : null;
}

interface MutableCookieStore {
  set: (options: {
    name: string;
    value: string;
    httpOnly: boolean;
    sameSite: "lax";
    path: string;
    secure: boolean;
    maxAge?: number;
  }) => void;
}

function joinCookieWriteOptions(secure: boolean) {
  return {
    name: PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
  };
}

/** Proxy / Response cookie write. Session cookie (no maxAge). */
export function applyPendingOrganizationJoinCookie(
  store: MutableCookieStore,
  token: string,
  secure: boolean,
): void {
  if (!isUsableJoinToken(token)) {
    return;
  }
  store.set({
    ...joinCookieWriteOptions(secure),
    value: token,
  });
}

export async function getPendingOrganizationJoinToken(): Promise<
  string | null
> {
  const store = await cookies();
  const token = store.get(PENDING_ORGANIZATION_JOIN_COOKIE_NAME)?.value;
  if (!token || !isUsableJoinToken(token)) {
    return null;
  }
  return token;
}

export async function setPendingOrganizationJoinToken(
  token: string,
): Promise<void> {
  if (!isUsableJoinToken(token)) {
    return;
  }

  const store = await cookies();
  applyPendingOrganizationJoinCookie(
    store,
    token,
    process.env.NODE_ENV === "production",
  );
}

export async function clearPendingOrganizationJoinToken(): Promise<void> {
  const store = await cookies();
  store.set({
    name: PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
}
