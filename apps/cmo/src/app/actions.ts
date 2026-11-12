"use server";

import { normalizeWebsiteUrl } from "@sokosumi/utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, startSokosumiSignIn } from "../lib/auth";
import {
  KEPT_WEBSITE_COOKIE,
  KEPT_WEBSITE_OPTIONS,
  SIGN_UP_CONTEXT_FIELD,
} from "../lib/kept-website";
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
  // The website first, then a Create account link's parameters in its order.
  const signUpContext: Record<string, string> = { url: websiteUrl };
  for (const [field, value] of formData) {
    const key = field.slice(SIGN_UP_CONTEXT_FIELD.length);
    if (
      field.startsWith(SIGN_UP_CONTEXT_FIELD) &&
      typeof value === "string" &&
      // Own keys only: `constructor` is inherited from Object.prototype.
      !Object.hasOwn(signUpContext, key)
    ) {
      signUpContext[key] = value;
    }
  }
  (await cookies()).set(KEPT_WEBSITE_COOKIE, websiteUrl, KEPT_WEBSITE_OPTIONS);
  return createAccount(signUpContext);
}

/**
 * Try again after a sign in that did not finish, with the website kept from
 * /start: Create account again, as the founder started it.
 */
export async function createAccountAgain() {
  const url = normalizeWebsiteUrl(
    (await cookies()).get(KEPT_WEBSITE_COOKIE)?.value ?? "",
  );
  if (!url) return signIn();
  return createAccount({ url });
}

async function createAccount(
  signUpContext: Record<string, string>,
): Promise<never> {
  const { url } = await startSokosumiSignIn(getAuth(), await headers(), {
    createAccount: true,
    signUpContext,
  });
  redirect(url);
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
