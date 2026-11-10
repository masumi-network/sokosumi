"use server";

import { normalizeWebsiteUrl } from "@sokosumi/utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, startSokosumiSignIn } from "../lib/auth";
import { KEPT_WEBSITE_COOKIE, KEPT_WEBSITE_OPTIONS } from "../lib/kept-website";
import type { OnboardFormState } from "./cmo-actions";

export async function signIn() {
  const { url } = await startSokosumiSignIn(getAuth(), await headers(), {
    createAccount: false,
  });
  redirect(url);
}

/**
 * The signed-out start: the website first, then Create account. CMO keeps the
 * website through the sign-in round trip (a failed one too), and Core keeps it
 * as the new account's sign-up context.
 */
export async function continueWithWebsite(
  previous: OnboardFormState,
  formData: FormData,
): Promise<OnboardFormState> {
  const typed = String(formData.get("websiteUrl") ?? "").trim();
  const websiteUrl = normalizeWebsiteUrl(typed);
  if (!websiteUrl) {
    return {
      attempt: previous.attempt + 1,
      websiteUrl: typed,
      errors: { websiteUrl: "Enter a website, like acme.com." },
    };
  }
  (await cookies()).set(KEPT_WEBSITE_COOKIE, websiteUrl, KEPT_WEBSITE_OPTIONS);
  const { url } = await startSokosumiSignIn(getAuth(), await headers(), {
    createAccount: true,
    signUpContext: { url: websiteUrl },
  });
  redirect(url);
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
