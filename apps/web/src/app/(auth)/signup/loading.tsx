import { useTranslations } from "next-intl";
import { Suspense } from "react";

import {
  AUTH_STEP_LINK_CLASS,
  AuthStepLayout,
} from "@/auth/components/auth-step-layout";
import { Skeleton } from "@/components/ui/skeleton";

import SignInLink from "./components/sign-in-link";

export default function RegisterLoadingPage() {
  const t = useTranslations("Auth.Pages.SignUp");

  return (
    <AuthStepLayout
      title={t("Header.title")}
      subtitle={t("Header.description")}
      links={
        <span>
          {t("Form.Login.message")}{" "}
          {/* The prerendered shell cannot know the query, so the link waits for it. */}
          <Suspense
            fallback={
              <span className={AUTH_STEP_LINK_CLASS}>
                {t("Form.Login.link")}
              </span>
            }
          >
            <SignInLink />
          </Suspense>
        </span>
      }
    >
      <div className="flex w-full flex-col gap-6">
        {/* First step: the email field and its button, then two providers. */}
        <div className="flex flex-col gap-6">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[50px] w-full" />
          <Skeleton className="h-[50px] w-full" />
        </div>
      </div>
    </AuthStepLayout>
  );
}
