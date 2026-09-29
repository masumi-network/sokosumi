"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  buildOAuthConsentReturnUrlFromSearchParams,
  buildSignInUrlFromSignUp,
} from "@/lib/auth/auth.utils";

// Reads the query itself so the sign-up form and its loading skeleton build
// the same link: the returnUrl, or the signed OAuth consent query.
export default function SignInLink() {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const searchParams = useSearchParams();
  const returnUrl =
    searchParams.get("returnUrl") ??
    buildOAuthConsentReturnUrlFromSearchParams(searchParams);

  return (
    <Link
      href={buildSignInUrlFromSignUp({ returnUrl })}
      className="text-primary text-sm font-medium hover:underline"
    >
      {t("Login.link")}
    </Link>
  );
}
