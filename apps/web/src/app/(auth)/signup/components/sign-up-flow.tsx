"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ConfirmedEmail } from "@/auth/components/confirmed-email";
import Divider from "@/auth/components/divider";
import { EmailStep } from "@/auth/components/email-step";
import SocialButtons from "@/auth/components/social-buttons";
import { useEmailCode } from "@/auth/components/use-email-code";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { handleUtmConversion } from "@/lib/actions/auth/action";
import { buildOAuthResumeUrlFromSearchParams } from "@/lib/auth/auth.utils";
import { takeSignUpHandover } from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { fireGTMEvent } from "@/lib/gtm-events";
import type { ProviderAuthMethod } from "@/lib/utils/last-used-auth-method";

import SignUpForm from "./form";
import SignUpHeader from "./header";
import SignInLink, { useSignInHref } from "./sign-in-link";

interface SignUpFlowProps {
  invitationId?: string | undefined;
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  prefilledEmail?: string | undefined;
  returnUrl?: string | undefined;
  lastUsedMethod: ProviderAuthMethod | null;
  /** Shown above the email step, e.g. why a sign-in brought the person back. */
  notice?: ReactNode;
  /** Shown under the methods of both steps, e.g. the terms notice. */
  children?: ReactNode;
}

/**
 * Sign-up in two steps. The first asks for the email beside the providers
 * and, for a new address, emails a code right away. The second asks for the
 * name and that code, or the name and a password instead.
 */
export default function SignUpFlow({
  invitationId,
  client,
  prefilledEmail,
  returnUrl,
  lastUsedMethod,
  notice,
  children,
}: SignUpFlowProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const searchParams = useSearchParams();
  const signInHref = useSignInHref();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  // Lives here, not in step 2: Continue sends the code before step 2 opens.
  const emailCode = useEmailCode({
    eventType: "signUp",
    returnUrl: effectiveReturnUrl,
    // Record UTM attribution for every successful signup.
    beforeLeaving: handleUtmConversion,
  });
  // An invitation fixes the address. Any other query email is only a
  // starting value, so a mistyped one can still be fixed.
  const emailLocked = Boolean(invitationId && prefilledEmail);
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [step, setStep] = useState<"email" | "details">("email");
  const [cameBack, setCameBack] = useState(false);
  const [isDetailsPending, setIsDetailsPending] = useState(false);
  // Step 1 starts one sign-up at a time: the email or a provider.
  const [isEmailPending, setIsEmailPending] = useState(false);
  const [isProviderPending, setIsProviderPending] = useState(false);
  const formStarted = useRef(false);

  // Sign-in found no account and emailed the code, so step 2 opens at once.
  // A layout effect: after a client navigation the email step never paints.
  useLayoutEffect(() => {
    if (emailLocked) return;
    const handover = takeSignUpHandover();
    if (!handover) return;
    setEmail(handover.email);
    if (handover.codeSentAt !== null) {
      emailCode.adoptSentCode(handover.email, handover.codeSentAt);
    }
    setStep("details");
  }, []);

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
        <SignUpHeader invitationId={invitationId} client={client} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <ConfirmedEmail
            email={email}
            onChange={
              emailLocked
                ? undefined
                : () => {
                    setCameBack(true);
                    setStep("email");
                  }
            }
            changeDisabled={isDetailsPending}
          />
          <SignUpForm
            email={email}
            returnUrl={returnUrl}
            emailCode={emailCode}
            onFormStart={handleFormStart}
            onPendingChange={setIsDetailsPending}
          />
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader invitationId={invitationId} client={client} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        {notice}
        <EmailStep
          defaultEmail={email}
          emailLocked={emailLocked}
          autoFocus={cameBack}
          autoComplete="email"
          captchaEntry="signup"
          detour={{
            when: "exists",
            title: t("AccountExists.title"),
            description: t("AccountExists.description"),
            label: t("AccountExists.logIn"),
            href: signInHref,
          }}
          onFormStart={handleFormStart}
          continueCaptcha={emailCode.captcha}
          onContinue={async (confirmedEmail, signal) => {
            setEmail(confirmedEmail);
            // A failed send has said so; step 2 then opens on the password.
            await emailCode.sendCode(confirmedEmail, { signal });
            if (!signal.aborted) setStep("details");
          }}
          disabled={isProviderPending}
          onPendingChange={setIsEmailPending}
        />
        <Divider />
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={lastUsedMethod}
          eventType="signUp"
          disabled={isEmailPending}
          onPendingChange={setIsProviderPending}
        />
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
