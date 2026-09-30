"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useRef, useState } from "react";

import Divider from "@/auth/components/divider";
import SocialButtons, {
  type SignInMethodId,
} from "@/auth/components/social-buttons";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { buildOAuthResumeUrlFromSearchParams } from "@/lib/auth/auth.utils";
import { fireGTMEvent } from "@/lib/gtm-events";

import { SignUpEmailStep } from "./email-step";
import SignUpForm from "./form";
import SignUpHeader from "./header";
import { SignUpMagicLink } from "./magic-link";
import SignInLink from "./sign-in-link";

interface SignUpFlowProps {
  invitationId?: string | undefined;
  /** The product that sent the person here through Sign in with Sokosumi. */
  clientName?: string | undefined;
  prefilledEmail?: string | undefined;
  returnUrl?: string | undefined;
  lastUsedMethod: SignInMethodId | null;
  showMagicLink: boolean;
  /** Shown under the methods of both steps, e.g. the terms notice. */
  children?: ReactNode;
}

/**
 * Sign-up in two steps. The first asks for the email beside the providers;
 * the second asks for name and password, or sends a Magic Link to the email
 * already given.
 */
export default function SignUpFlow({
  invitationId,
  clientName,
  prefilledEmail,
  returnUrl,
  lastUsedMethod,
  showMagicLink,
  children,
}: SignUpFlowProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [step, setStep] = useState<"email" | "details">("email");
  const [cameBack, setCameBack] = useState(false);
  const [isDetailsPending, setIsDetailsPending] = useState(false);
  const formStarted = useRef(false);

  // when user first sees the register page
  useMountEffect(() => {
    fireGTMEvent.viewRegisterArea();
  });

  // when user starts typing, on whichever step that happens
  function handleFormStart() {
    if (formStarted.current) {
      return;
    }
    formStarted.current = true;
    fireGTMEvent.registerFormStart();
  }

  if (step === "details") {
    return (
      <div className="flex flex-1 flex-col">
        <SignUpHeader
          invitationId={invitationId}
          description={
            <span className="break-words">
              {t("registeringAs", { email })}{" "}
              {prefilledEmail ? null : (
                <Button
                  type="button"
                  variant="link"
                  disabled={isDetailsPending}
                  className="h-auto p-0 align-baseline"
                  onClick={() => {
                    setCameBack(true);
                    setStep("email");
                  }}
                >
                  {t("changeEmail")}
                </Button>
              )}
            </span>
          }
        />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <SignUpForm
            email={email}
            returnUrl={returnUrl}
            onFormStart={handleFormStart}
            onPendingChange={setIsDetailsPending}
          />
          {showMagicLink ? (
            <>
              <Divider labelKey="magicLinkDivider" />
              <SignUpMagicLink email={email} returnUrl={effectiveReturnUrl} />
            </>
          ) : null}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader invitationId={invitationId} clientName={clientName} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SignUpEmailStep
          defaultEmail={email}
          emailLocked={Boolean(prefilledEmail)}
          autoFocus={cameBack}
          onFormStart={handleFormStart}
          onContinue={(confirmedEmail) => {
            setEmail(confirmedEmail);
            setStep("details");
          }}
        />
        <Divider labelKey="orDivider" />
        <SocialButtons returnUrl={returnUrl} lastUsedMethod={lastUsedMethod} />
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Login.message")}
          </span>
          <SignInLink />
        </div>
        {children}
      </div>
    </div>
  );
}
