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

import {
  AUTH_STEP_LINK_CLASS,
  AuthStepLayout,
} from "@/auth/components/auth-step-layout";
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
  rememberAuthEmailHint,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
  takeSignInHandover,
} from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  chooseSignInMethod,
  type LastUsedAuthMethod,
  type SignInMethod,
  toProviderAuthMethod,
} from "@/lib/utils/last-used-auth-method";

import SignInForm from "./form";

interface SignInFlowProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /** The invitation's address, read from Core by id; it cannot be changed. */
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
 * the password, opening as `chooseSignInMethod` decides. Register hands an
 * address that has an account straight to the second step.
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
  const headerT = useTranslations("Auth.Pages.SignIn.Header");
  const emailT = useTranslations("Auth.Email.Form");
  const searchParams = useSearchParams();
  const router = useRouter();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  // The invitation whose address this page locked; sign-up locks it too.
  const lockedInvitationId =
    invitationId && prefilledEmail ? invitationId : undefined;
  const signUpHref = buildSignUpUrlFromSignIn({
    returnUrl,
    oauthQuery: returnUrl
      ? undefined
      : buildSignedOAuthQueryFromSearchParams(searchParams),
    invitationId: lockedInvitationId,
  });
  // Lives here, not in step 2: Continue sends the code before step 2 opens.
  const emailCode = useEmailCode({
    eventType: "signIn",
    returnUrl: effectiveReturnUrl,
  });
  // Set on Continue, from this browser and the account.
  const [initialMethod, setInitialMethod] = useState<SignInMethod>("code");
  const isEmailLastUsed =
    lastUsedMethod === "email" || lastUsedMethod === "email-otp";
  const [email, setEmail] = useState(prefilledEmail ?? "");
  // What step 1's field holds now, for the Register link beside it.
  const [typedEmail, setTypedEmail] = useState(prefilledEmail ?? "");
  const [step, setStep] = useState<"email" | "method">("email");
  const [cameBack, setCameBack] = useState(false);
  // Step 1 starts one sign-in at a time: the email or a provider.
  const [isEmailPending, setIsEmailPending] = useState(false);
  const [isProviderPending, setIsProviderPending] = useState(false);
  // Register found an account and handed the address over.
  const [handedOver, setHandedOver] = useState(false);
  const formStarted = useRef(false);

  // Register found an account and chose the method as Continue here would,
  // so step 2 opens at once. A layout effect: after a client navigation the
  // email step never paints. An invitation fixes the address, so only a
  // hand-over for that address counts; any other is discarded.
  useLayoutEffect(() => {
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
    setStep("method");
  }, []);

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
      <SignInForm
        client={client}
        email={email}
        onChangeEmail={
          // An invitation fixes the address.
          prefilledEmail
            ? undefined
            : () => {
                setCameBack(true);
                setHandedOver(false);
                setStep("email");
              }
        }
        returnUrl={returnUrl}
        initialMethod={initialMethod}
        handedOver={handedOver}
        emailCode={emailCode}
        onFormStart={handleFormStart}
      >
        {children}
      </SignInForm>
    );
  }

  return (
    <AuthStepLayout
      client={client}
      title={headerT("title")}
      subtitle={
        // Whatever locks the field explains why.
        prefilledEmail
          ? emailT("invitation")
          : client
            ? headerT("descriptionFor", { client: client.name })
            : headerT("description")
      }
      notice={notice}
      links={
        <span>
          {t("Register.message")}{" "}
          <Link
            href={signUpHref}
            className={AUTH_STEP_LINK_CLASS}
            onAuxClick={() => takeAuthEmailHint()}
            // A typed email travels as an editable hint. Sign-up looks up an
            // invitation's address itself.
            onClick={(event) => {
              rememberAuthEmailHintOnClick(
                event,
                lockedInvitationId ? "" : typedEmail,
              );
            }}
          >
            {t("Register.link")}
          </Link>
        </span>
      }
      footer={children}
    >
      <div className="flex w-full flex-col gap-6">
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
            // Sign-up's first step would only ask Core again and send this
            // code, so it is sent here and sign-up opens on its second step.
            follow: async (newEmail, signal) => {
              const codeSentAt = await emailCode.sendCode(newEmail, {
                signal,
              });
              if (signal.aborted) return;
              rememberAuthEmailHint(newEmail, { signUp: { codeSentAt } });
              router.push(signUpHref);
            },
          }}
          onFormStart={handleFormStart}
          onEmailChange={setTypedEmail}
          continueCaptcha={emailCode.captcha}
          onContinue={async (confirmedEmail, signal, account) => {
            setEmail(confirmedEmail);
            const method = chooseSignInMethod(lastUsedMethod, account);
            setInitialMethod(method);
            // A failed send has said so; step 2 then opens on the password.
            if (method === "code") {
              await emailCode.sendCode(confirmedEmail, { signal });
            }
            if (!signal.aborted) setStep("method");
          }}
          disabled={isProviderPending}
          onPendingChange={setIsEmailPending}
        />
        <Divider />
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={toProviderAuthMethod(lastUsedMethod)}
          showPasskey
          disabled={isEmailPending}
          onPendingChange={setIsProviderPending}
        />
      </div>
    </AuthStepLayout>
  );
}
