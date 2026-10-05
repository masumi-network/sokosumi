"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { buildAuthPageUrl, readAuthPageContext } from "@/lib/auth/auth.utils";

// Reads the query itself so the sign-up form and its loading skeleton build
// the same link: the returnUrl or the signed OAuth request, and the
// invitation.
export function useSignInHref(): string {
  return buildAuthPageUrl("/signin", readAuthPageContext(useSearchParams()));
}

function SignInLink() {
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

/**
 * Register's "Already have an account? Log in". The prerendered loading shell
 * cannot know the query, so the link waits for it behind its own label.
 */
export default function SignInRow() {
  const t = useTranslations("Auth.Pages.SignUp.Form");

  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
      <span className="text-muted-foreground text-sm">
        {t("Login.message")}
      </span>
      <Suspense
        fallback={
          <span className="text-primary text-sm font-medium">
            {t("Login.link")}
          </span>
        }
      >
        <SignInLink />
      </Suspense>
    </div>
  );
}
