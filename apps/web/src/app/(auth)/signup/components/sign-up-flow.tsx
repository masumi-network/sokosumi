"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AuthStepLayout } from "@/auth/components/auth-step-layout";
import Divider from "@/auth/components/divider";
import { EmailStep } from "@/auth/components/email-step";
import SocialButtons from "@/auth/components/social-buttons";
import { useEmailCode } from "@/auth/components/use-email-code";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { handleUtmConversion } from "@/lib/actions/auth/action";
import { buildOAuthResumeUrlFromSearchParams } from "@/lib/auth/auth.utils";
import {
  rememberAuthEmailHint,
  takeSignUpHandover,
} from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  chooseSignInMethod,
  type LastUsedAuthMethod,
  toProviderAuthMethod,
} from "@/lib/utils/last-used-auth-method";

import SignUpForm from "./form";
import SignInLink, { useSignInHref } from "./sign-in-link";

interface SignUpFlowProps {
  invitationId?: string | undefined;
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  prefilledEmail?: string | undefined;
  returnUrl?: string | undefined;
  /** How this browser signed in or signed up last, from Better Auth's cookie. */
  lastUsedMethod: LastUsedAuthMethod | null;
  /** Shown above the email step, e.g. why a sign-in brought the person back. */
  notice?: ReactNode;
  /** Shown under the methods of both steps, e.g. the terms notice. */
  children?: ReactNode;
}

/**
 * Sign-up in two steps. The first asks for the email beside the providers
 * and, for a new address, emails a code right away. The second asks for the
 * name and that code, with a password as an optional addition. An address
 * that has an account goes to Log in's second step.
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
  const headerT = useTranslations("Auth.Pages.SignUp.Header");
  const emailT = useTranslations("Auth.Email.Form");
  const searchParams = useSearchParams();
  const router = useRouter();
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
  // An invitation fixes the address, which the page read from Core by the
  // invitation's id. The URL never carries an address.
  const emailLocked = Boolean(invitationId && prefilledEmail);
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [step, setStep] = useState<"email" | "details">("email");
  const [cameBack, setCameBack] = useState(false);
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
      <SignUpForm
        client={client}
        email={email}
        onChangeEmail={
          // An invitation fixes the address.
          emailLocked
            ? undefined
            : () => {
                setCameBack(true);
                setStep("email");
              }
        }
        emailCode={emailCode}
        onFormStart={handleFormStart}
      >
        {children}
      </SignUpForm>
    );
  }

  return (
    <AuthStepLayout
      client={client}
      title={headerT("title")}
      subtitle={
        emailLocked
          ? emailT("invitation")
          : client
            ? headerT("descriptionFor", { client: client.name })
            : headerT("description")
      }
      notice={notice}
      links={
        <span>
          {t("Login.message")} <SignInLink />
        </span>
      }
      footer={children}
    >
      <div className="flex w-full flex-col gap-6">
        <EmailStep
          defaultEmail={email}
          emailLocked={emailLocked}
          autoFocus={cameBack}
          autoComplete="email"
          captchaEntry="signup"
          detour={{
            when: "exists",
            // Log in's first step would only ask Core again and send this
            // code, so it opens on its second step, an invitation's too.
            handOver: async (knownEmail, signal, account) => {
              const method = chooseSignInMethod(lastUsedMethod, account);
              const codeSentAt =
                method === "code"
                  ? await emailCode.sendCode(knownEmail, { signal })
                  : null;
              if (signal.aborted) return;
              rememberAuthEmailHint(knownEmail, {
                signIn: method === "code" ? { method, codeSentAt } : { method },
              });
              router.push(signInHref);
            },
          }}
          onFormStart={handleFormStart}
          continueCaptcha={emailCode.captcha}
          onContinue={async (confirmedEmail, signal) => {
            setEmail(confirmedEmail);
            // A failed send has said so; step 2 then opens with the code
            // unsent and a new one a click away.
            await emailCode.sendCode(confirmedEmail, { signal });
            if (!signal.aborted) setStep("details");
          }}
          disabled={isProviderPending}
          onPendingChange={setIsEmailPending}
        />
        <Divider />
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={toProviderAuthMethod(lastUsedMethod)}
          eventType="signUp"
          disabled={isEmailPending}
          onPendingChange={setIsProviderPending}
        />
      </div>
    </AuthStepLayout>
  );
}
