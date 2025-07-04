import "server-only";

import { headers } from "next/headers";

import { auth, Session } from "@/lib/auth/auth";

import { UnAuthorizedError } from "./errors";

export async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
}

export async function getSessionOrThrow(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    // Get the current URL from headers for server-side redirect
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "";
    const searchParams = headersList.get("x-search-params") ?? "";
    const currentUrl = pathname + searchParams;

    throw new UnAuthorizedError(currentUrl);
  }
  return session;
}

export async function verifyUserId(userId: string): Promise<void> {
  const session = await getSessionOrThrow();
  if (session.user.id !== userId) {
    console.error(
      `UserId ${userId} does not match session user id ${session.user.id}`,
    );
    throw new Error("UserId does not match session user id");
  }
}

export async function getActiveOrganizationId(): Promise<
  string | null | undefined
> {
  const session = await getSession();
  return session?.session.activeOrganizationId;
}
