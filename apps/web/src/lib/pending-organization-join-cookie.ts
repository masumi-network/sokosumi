import { cookies } from "next/headers";

/** Capability token from `/join/[token]` so `/setup` can recover mid-flow. */
export const PENDING_ORGANIZATION_JOIN_COOKIE_NAME =
  "sokosumi_pending_org_join";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function isUsableJoinToken(token: string): boolean {
  return token.length > 0 && token.length <= 256 && !/\s/.test(token);
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
  store.set({
    name: PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
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
