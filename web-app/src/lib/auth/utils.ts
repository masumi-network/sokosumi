"use server";

import { headers } from "next/headers";

import { auth, Session } from "@/lib/auth/auth";

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

export async function verifyUserId(userId: string): Promise<void> {
  const session = await getSession();
  if (session.user.id !== userId) {
    throw new Error("UserId does not match session user id");
  }
}
