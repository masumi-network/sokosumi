import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { AuthHeader } from "@/auth/components/auth-header";
import { AuthPage } from "@/auth/components/auth-page";
import { Skeleton } from "@/components/ui/skeleton";

import SignInLink from "./components/sign-in-link";

export default function RegisterLoadingPage() {
  const t = useTranslations("Auth.Pages.SignUp");

  return (
    <AuthPage header={<AuthHeader mode="signUp" />}>
      {/* First step: the email field and its button, then two providers. */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[50px] w-full" />
        <Skeleton className="h-[50px] w-full" />
      </div>
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <span className="text-muted-foreground text-sm">
          {t("Form.Login.message")}
        </span>
        {/* The prerendered shell cannot know the query, so the link waits for it. */}
        <Suspense
          fallback={
            <span className="text-primary text-sm font-medium">
              {t("Form.Login.link")}
            </span>
          }
        >
          <SignInLink />
        </Suspense>
      </div>
    </AuthPage>
  );
}
