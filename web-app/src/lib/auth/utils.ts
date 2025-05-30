"use server";

import { headers } from "next/headers";

import { auth, Session, SessionUser } from "@/lib/auth/auth";

import { UnAuthorizedError } from "./errors";

export async function getSession(): Promise<Session> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new UnAuthorizedError();
  }

  return session as Session;
}

export async function getSessionUser(): Promise<SessionUser> {
  const session = await getSession();
  return session.user;
}

export async function verifyUserId(userId: string): Promise<void> {
  const sessionUser = await getSessionUser();
  if (sessionUser.id !== userId) {
    throw new Error("UserId does not match session user id");
  }
}
