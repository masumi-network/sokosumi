"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { ConfirmedEmail } from "@/auth/components/confirmed-email";
import Divider from "@/auth/components/divider";
import { EmailStep } from "@/auth/components/email-step";
import SocialButtons from "@/auth/components/social-buttons";
import { useEmailCode } from "@/auth/components/use-email-code";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  buildOAuthResumeUrlFromSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  buildSignUpUrlFromSignIn,
} from "@/lib/auth/auth.utils";
import {
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  type LastUsedAuthMethod,
  toProviderAuthMethod,
} from "@/lib/utils/last-used-auth-method";

import SignInForm, { type SignInMethod } from "./form";
import SignInHeader from "./header";

interface SignInFlowProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /** An address from the link, which the person cannot change. */
  prefilledEmail?: string | undefined;
  /** The invitation `prefilledEmail` belongs to; it stays fixed on sign-up. */
  invitationId?: string | undefined;
  returnUrl?: string | undefined;
  /** How this browser signed in or signed up last, from Better Auth's cookie. */
  lastUsedMethod: LastUsedAuthMethod | null;
  /** Shown above the email step, e.g. why a sign-in brought the person back. */
  notice?: ReactNode;
  /** Shown under the methods of both steps, e.g. the terms notice. */
  children?: ReactNode;
}

/**
 * Sign-in in two steps. The first asks for the email beside the providers
 * and checks that it has an account. The second asks for the emailed code or
 * the password, opening on the one this browser used last.
 */
export default function SignInFlow({
  client,
  prefilledEmail,
  invitationId,
  returnUrl,
  lastUsedMethod,
  notice,
  children,
}: SignInFlowProps) {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const invitation =
    invitationId && prefilledEmail
      ? { id: invitationId, email: prefilledEmail }
      : undefined;
  const signUpHref = buildSignUpUrlFromSignIn({
    returnUrl,
    oauthQuery: returnUrl
      ? undefined
      : buildSignedOAuthQueryFromSearchParams(searchParams),
    invitation,
  });
  // Lives here, not in step 2: Continue sends the code before step 2 opens.
  const emailCode = useEmailCode({
    eventType: "signIn",
    returnUrl: effectiveReturnUrl,
  });
  // A password person is not emailed a code they will not use.
  const initialMethod: SignInMethod =
    lastUsedMethod === "email" ? "password" : "code";
  const isEmailLastUsed =
    lastUsedMethod === "email" || lastUsedMethod === "email-otp";
  const [email, setEmail] = useState(prefilledEmail ?? "");
  // What step 1's field holds now, for the Register link beside it.
  const [typedEmail, setTypedEmail] = useState(prefilledEmail ?? "");
  const [step, setStep] = useState<"email" | "method">("email");
  const [cameBack, setCameBack] = useState(false);
  const [isMethodPending, setIsMethodPending] = useState(false);
  const formStarted = useRef(false);

  // when user first sees the login area
  useMountEffect(() => {
    fireGTMEvent.viewLoginArea();
  });

  // when user starts typing, on whichever step that happens
  function handleFormStart() {
    if (formStarted.current) {
      return;
    }
    formStarted.current = true;
    fireGTMEvent.loginAreaFormStart();
  }

  if (step === "method") {
    return (
      <div className="flex flex-1 flex-col">
        <SignInHeader client={client} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <ConfirmedEmail
            email={email}
            onChange={
              // An invitation fixes the address.
              prefilledEmail
                ? undefined
                : () => {
                    setCameBack(true);
                    setStep("email");
                  }
            }
            changeDisabled={isMethodPending}
          />
          <SignInForm
            email={email}
            returnUrl={returnUrl}
            initialMethod={initialMethod}
            emailCode={emailCode}
            onFormStart={handleFormStart}
            onPendingChange={setIsMethodPending}
          />
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader client={client} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        {notice}
        <EmailStep
          defaultEmail={email}
          emailLocked={Boolean(prefilledEmail)}
          autoFocus={cameBack}
          autoComplete="username webauthn"
          captchaEntry="signin"
          lastUsedLabel={isEmailLastUsed ? t("lastUsed") : undefined}
          detour={{
            when: "missing",
            title: t("NoAccount.title"),
            description: t("NoAccount.description"),
            label: t("NoAccount.createAccount"),
            href: signUpHref,
          }}
          onFormStart={handleFormStart}
          onEmailChange={setTypedEmail}
          continueCaptcha={emailCode.captcha}
          onContinue={async (confirmedEmail) => {
            setEmail(confirmedEmail);
            // A failed send has said so; step 2 then opens on the password.
            if (initialMethod === "code") {
              await emailCode.sendCode(confirmedEmail);
            }
            setStep("method");
          }}
        />
        <Divider />
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={toProviderAuthMethod(lastUsedMethod)}
          showPasskey
        />
        <div className="flex flex-row items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {t("Register.message")}
          </span>
          <Link
            href={signUpHref}
            className="text-primary text-sm font-medium hover:underline"
            onAuxClick={() => takeAuthEmailHint()}
            // A typed email stays out of the link, which would lock it on
            // sign-up. Only an invitation's address belongs there.
            onClick={(event) => {
              rememberAuthEmailHintOnClick(event, invitation ? "" : typedEmail);
            }}
          >
            {t("Register.link")}
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
