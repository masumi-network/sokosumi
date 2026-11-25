"use server";

import { getUsersById } from "@sokosumi/core-client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { authEvent } from "../lib/analytics";
import { getAuth, startSokosumiSignIn } from "../lib/auth";
import { coreForCurrentUser } from "../lib/core";
import { signedOutCookie } from "../lib/signed-out";

export async function signIn() {
  const { url } = await startSokosumiSignIn(getAuth(), await headers(), {
    createAccount: false,
  });
  redirect(url);
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  (await cookies()).set(...signedOutCookie());
  redirect("/");
}

/**
 * The signed-in person for GA4: their Core user id (opaque, never the email)
 * and, right after a sign-in, sign_up for an account made just now or login.
 */
export async function readAnalyticsUser(justSignedIn: boolean): Promise<{
  userId: string;
  event: "sign_up" | "login" | null;
} | null> {
  const core = await coreForCurrentUser();
  if (!core) return null;
  const { data } = await getUsersById({ ...core, path: { id: "me" } });
  if (!data) return null;
  return {
    userId: data.data.id,
    event: justSignedIn ? authEvent(new Date(data.data.createdAt)) : null,
  };
}
