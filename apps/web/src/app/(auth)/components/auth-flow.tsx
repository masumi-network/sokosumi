"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AuthHeader } from "@/auth/components/auth-header";
import { EmailChip } from "@/auth/components/email-chip";
import { EmailStep } from "@/auth/components/email-step";
import SocialButtons from "@/auth/components/social-buttons";
import { useEmailCode } from "@/auth/components/use-email-code";
import SignInForm from "@/auth/signin/components/form";
import SignUpForm from "@/auth/signup/components/form";
import SignInLink, {
  useSignInHref,
} from "@/auth/signup/components/sign-in-link";
import { runWithCaptchaPass } from "@/components/auth-captcha";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { handleUtmConversion } from "@/lib/actions/auth/action";
import {
  buildAuthPageUrl,
  buildOAuthResumeUrlFromSearchParams,
  buildSignedOAuthQueryFromSearchParams,
} from "@/lib/auth/auth.utils";
import {
  rememberAuthEmailHint,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
  takeSignInHandover,
  takeSignUpHandover,
} from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  chooseSignInMethod,
  type LastUsedAuthMethod,
  type SignInMethod,
  toProviderAuthMethod,
} from "@/lib/utils/last-used-auth-method";

/** Log in (`/signin`) or Register (`/signup`). */
export type AuthMode = "signIn" | "signUp";

interface AuthFlowProps {
  mode: AuthMode;
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /**
   * The invitation's address, read from Core by id; it cannot be changed.
   * The URL never carries an address.
   */
  prefilledEmail?: string | undefined;
  /** The invitation `prefilledEmail` belongs to. */
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
 * Log in and Register, each in two steps. The first asks for the email beside
 * the providers and asks Core whether it has an account. Log in's second step
 * asks for the emailed code or the password, opening as `chooseSignInMethod`
 * decides; Register's asks for the name and the code it emailed, or a
 * password instead. An address on the wrong page goes to the other page's
 * second step, with the code already sent: Log in hands over one without an
 * account, Register one that has an account.
 */
export default function AuthFlow({
  mode,
  client,
  prefilledEmail,
  invitationId,
  returnUrl,
  lastUsedMethod,
  notice,
  children,
}: AuthFlowProps) {
  const isSignIn = mode === "signIn";
  const signInT = useTranslations("Auth.Pages.SignIn.Form");
  const signUpT = useTranslations("Auth.Pages.SignUp.Form");
  const socialT = useTranslations("Auth.SocialButtons");
  const searchParams = useSearchParams();
  const router = useRouter();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const emailLocked = Boolean(prefilledEmail);
  // The invitation whose address this page locked; the other page locks it too.
  const lockedInvitationId = emailLocked ? invitationId : undefined;
  const signUpHref = buildAuthPageUrl("/signup", {
    returnUrl,
    oauthQuery: returnUrl
      ? undefined
      : buildSignedOAuthQueryFromSearchParams(searchParams),
    invitationId: lockedInvitationId,
  });
  const signInHref = useSignInHref();
  // Lives here, not in step 2: Continue sends the code before step 2 opens.
  const emailCode = useEmailCode({
    eventType: mode,
    returnUrl: effectiveReturnUrl,
    // Record UTM attribution for every successful signup.
    beforeLeaving: isSignIn ? undefined : handleUtmConversion,
  });
  const [email, setEmail] = useState(prefilledEmail ?? "");
  // What step 1's field holds now, for Log in's Register link beside it.
  const [typedEmail, setTypedEmail] = useState(prefilledEmail ?? "");
  const [step, setStep] = useState<"email" | "finish">("email");
  const [cameBack, setCameBack] = useState(false);
  const [isFinishPending, setIsFinishPending] = useState(false);
  // Step 1 starts one attempt at a time: the email or a provider.
  const [isEmailPending, setIsEmailPending] = useState(false);
  const [isProviderPending, setIsProviderPending] = useState(false);
  // Log in only. Set on Continue, from this browser and the account.
  const [initialMethod, setInitialMethod] = useState<SignInMethod>("code");
  // Log in only. Register found an account and handed the address over.
  const [handedOver, setHandedOver] = useState(false);
  const formStarted = useRef(false);
  const isEmailLastUsed =
    lastUsedMethod === "email" || lastUsedMethod === "email-otp";

  // The other page handed an address over, so step 2 opens at once. A layout
  // effect: after a client navigation the email step never paints.
  useLayoutEffect(() => {
    if (isSignIn) {
      // Register found an account and chose the method as Continue here
      // would. An invitation fixes the address, so only a hand-over for that
      // address counts; any other is discarded.
      const handover = takeSignInHandover();
      if (!handover) return;
      if (
        prefilledEmail &&
        handover.email.toLowerCase() !== prefilledEmail.toLowerCase()
      ) {
        return;
      }
      const handedOverEmail = prefilledEmail ?? handover.email;
      setEmail(handedOverEmail);
      setInitialMethod(handover.method);
      if (handover.method === "code" && handover.codeSentAt !== null) {
        emailCode.adoptSentCode(handedOverEmail, handover.codeSentAt);
      }
      setHandedOver(true);
    } else {
      // Log in found no account and emailed the code.
      if (emailLocked) return;
      const handover = takeSignUpHandover();
      if (!handover) return;
      setEmail(handover.email);
      if (handover.codeSentAt !== null) {
        emailCode.adoptSentCode(handover.email, handover.codeSentAt);
      }
    }
    setStep("finish");
  }, []);

  // when user first sees the login or register area
  useMountEffect(() => {
    if (isSignIn) fireGTMEvent.viewLoginArea();
    else fireGTMEvent.viewRegisterArea();
  });

  // when user starts typing, on whichever step that happens
  function handleFormStart() {
    if (formStarted.current) {
      return;
    }
    formStarted.current = true;
    if (isSignIn) fireGTMEvent.loginAreaFormStart();
    else fireGTMEvent.registerFormStart();
  }

  function frame(content: ReactNode) {
    return (
      <div className="flex flex-1 flex-col">
        <AuthHeader mode={mode} client={client} invitationId={invitationId} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          {content}
          {children}
        </div>
      </div>
    );
  }

  if (step === "finish") {
    return frame(
      <>
        <EmailChip
          email={email}
          onChange={
            // An invitation fixes the address.
            emailLocked
              ? undefined
              : () => {
                  setCameBack(true);
                  setHandedOver(false);
                  setStep("email");
                }
          }
          disabled={isFinishPending}
        />
        {isSignIn ? (
          <SignInForm
            email={email}
            returnUrl={returnUrl}
            initialMethod={initialMethod}
            handedOver={handedOver}
            emailCode={emailCode}
            onFormStart={handleFormStart}
            onPendingChange={setIsFinishPending}
          />
        ) : (
          <SignUpForm
            email={email}
            emailCode={emailCode}
            onFormStart={handleFormStart}
            onPendingChange={setIsFinishPending}
          />
        )}
      </>,
    );
  }

  return frame(
    <>
      {notice}
      <EmailStep
        defaultEmail={email}
        emailLocked={emailLocked}
        autoFocus={cameBack}
        autoComplete={isSignIn ? "username webauthn" : "email"}
        captchaEntry={isSignIn ? "signin" : "signup"}
        lastUsedLabel={
          isSignIn && isEmailLastUsed ? signInT("lastUsed") : undefined
        }
        detour={
          isSignIn
            ? {
                when: "missing",
                title: signInT("NoAccount.title"),
                description: signInT("NoAccount.description"),
                label: signInT("NoAccount.createAccount"),
                href: signUpHref,
                // Register's first step would only ask Core again and send
                // this code, so it is sent here and Register opens on its
                // second step.
                follow: async (newEmail, signal, { captchaPass }) => {
                  const codeSentAt = await emailCode.sendCode(newEmail, {
                    signal,
                    runWithCaptcha: runWithCaptchaPass(captchaPass),
                  });
                  if (signal.aborted) return;
                  rememberAuthEmailHint(newEmail, { signUp: { codeSentAt } });
                  router.push(signUpHref);
                },
              }
            : {
                when: "exists",
                // Log in's first step would only ask Core again and send this
                // code, so it opens on its second step, an invitation's too.
                handOver: async (knownEmail, signal, account) => {
                  const method = chooseSignInMethod(lastUsedMethod, account);
                  const codeSentAt =
                    method === "code"
                      ? await emailCode.sendCode(knownEmail, {
                          signal,
                          runWithCaptcha: runWithCaptchaPass(
                            account.captchaPass,
                          ),
                        })
                      : null;
                  if (signal.aborted) return;
                  rememberAuthEmailHint(knownEmail, {
                    signIn:
                      method === "code" ? { method, codeSentAt } : { method },
                  });
                  router.push(signInHref);
                },
              }
        }
        onFormStart={handleFormStart}
        onEmailChange={setTypedEmail}
        onContinue={async (confirmedEmail, signal, account) => {
          setEmail(confirmedEmail);
          // Register always emails a code; Log in may open on the password.
          const method = isSignIn
            ? chooseSignInMethod(lastUsedMethod, account)
            : "code";
          setInitialMethod(method);
          // A failed send has said so; step 2 then opens on the password.
          if (method === "code") {
            await emailCode.sendCode(confirmedEmail, {
              signal,
              runWithCaptcha: runWithCaptchaPass(account.captchaPass),
            });
          }
          if (!signal.aborted) setStep("finish");
        }}
        disabled={isProviderPending}
        onPendingChange={setIsEmailPending}
      />
      <div className="flex items-center justify-between gap-2">
        <hr className="h-0 flex-1 border-0 border-t border-border" />
        <span className="text-xs text-muted-foreground">
          {socialT("orDivider")}
        </span>
        <hr className="h-0 flex-1 border-0 border-t border-border" />
      </div>
      <SocialButtons
        returnUrl={effectiveReturnUrl}
        lastUsedMethod={toProviderAuthMethod(lastUsedMethod)}
        showPasskey={isSignIn}
        eventType={mode}
        disabled={isEmailPending}
        onPendingChange={setIsProviderPending}
      />
      {isSignIn ? (
        <div className="flex flex-row items-center justify-center gap-2">
          <span className="text-muted-foreground text-sm">
            {signInT("Register.message")}
          </span>
          <Link
            href={signUpHref}
            className="text-primary text-sm font-medium hover:underline"
            onAuxClick={() => takeAuthEmailHint()}
            // A typed email travels as an editable hint. Register looks up an
            // invitation's address itself.
            onClick={(event) => {
              rememberAuthEmailHintOnClick(
                event,
                lockedInvitationId ? "" : typedEmail,
              );
            }}
          >
            {signInT("Register.link")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <span className="text-muted-foreground text-sm">
            {signUpT("Login.message")}
          </span>
          <SignInLink />
        </div>
      )}
    </>,
  );
}
