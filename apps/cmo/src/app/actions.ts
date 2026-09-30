"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "../lib/auth";
import { SOKOSUMI_OAUTH_PROVIDER_ID } from "../lib/sokosumi-oauth";

export async function signIn() {
  const { url } = await getAuth().api.signInSocial({
    body: {
      provider: SOKOSUMI_OAUTH_PROVIDER_ID,
      callbackURL: "/",
      errorCallbackURL: "/",
    },
    headers: await headers(),
  });
  if (!url) throw new Error("Sign in with Sokosumi returned no URL");
  redirect(url);
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
