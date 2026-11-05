"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, startSokosumiSignIn } from "../lib/auth";

export async function signIn() {
  const { url } = await startSokosumiSignIn(getAuth(), await headers(), {
    createAccount: false,
  });
  redirect(url);
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
