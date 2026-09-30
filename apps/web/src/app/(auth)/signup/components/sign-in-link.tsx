"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  buildSignedOAuthQueryFromSearchParams,
  buildSignInUrlFromSignUp,
} from "@/lib/auth/auth.utils";

// Reads the query itself so the sign-up form and its loading skeleton build
// the same link: the returnUrl, or the signed OAuth request.
export function useSignInHref(): string {
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? undefined;
  const oauthQuery = returnUrl
    ? undefined
    : buildSignedOAuthQueryFromSearchParams(searchParams);

  return buildSignInUrlFromSignUp({ returnUrl, oauthQuery });
}

export default function SignInLink() {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const href = useSignInHref();

  return (
    <Link
      href={href}
      className="text-primary text-sm font-medium hover:underline"
    >
      {t("Login.link")}
    </Link>
  );
}
