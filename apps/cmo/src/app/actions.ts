"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "../lib/auth";
import { sokosumiSignInBody } from "../lib/sokosumi-oauth";

async function startSignIn(options: { createAccount: boolean }) {
  const { url } = await getAuth().api.signInSocial({
    body: sokosumiSignInBody(options),
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
  redirect("/");
}
