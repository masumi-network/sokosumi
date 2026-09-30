"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "../lib/auth";
import { SIGNED_OUT_COOKIE, sokosumiSignInBody } from "../lib/sokosumi-oauth";

async function startSignIn(options: { createAccount: boolean }) {
  const signInAgain = (await cookies()).has(SIGNED_OUT_COOKIE);
  const { url } = await getAuth().api.signInSocial({
    body: sokosumiSignInBody({ ...options, signInAgain }),
    headers: await headers(),
  });
  if (!url) throw new Error("Sign in with Sokosumi returned no URL");
  redirect(url);
}

export async function signIn() {
  await startSignIn({ createAccount: false });
}

export async function createAccount() {
  await startSignIn({ createAccount: true });
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  (await cookies()).set(SIGNED_OUT_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Outlives a browser restart, as Sokosumi's own session does.
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}
