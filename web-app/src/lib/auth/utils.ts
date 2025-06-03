"use server";

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
    throw new UnAuthorizedError();
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
