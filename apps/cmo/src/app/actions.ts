"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, startSokosumiSignIn } from "../lib/auth";
import type { SokosumiSignInOptions } from "../lib/sokosumi-oauth";

async function startSignIn(options: SokosumiSignInOptions) {
  const { url } = await startSokosumiSignIn(
    getAuth(),
    await headers(),
    options,
  );
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
