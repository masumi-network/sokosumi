"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, Session, SessionUser } from "@/lib/auth/auth";

import { UnAuthorizedError } from "./errors";

export async function getSession(
  shouldRedirect: boolean = true,
): Promise<Session> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    if (shouldRedirect) {
      redirect("/login");
    }
    throw new UnAuthorizedError();
  }

  return session as Session;
}

export async function getSessionUser(
  shouldRedirect: boolean = false,
): Promise<SessionUser> {
  const session = await getSession(shouldRedirect);

  if (!session.user) {
    throw new UnAuthorizedError();
  }

  return session.user;
}

export async function verifyUserIdWithSession(userId: string): Promise<void> {
  const sessionUser = await getSessionUser(false);

  if (sessionUser.id !== userId) {
    throw new Error("UserId does not match session user id");
  }
}
