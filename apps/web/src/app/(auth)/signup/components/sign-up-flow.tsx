"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";

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
  /** Shown above the email step, e.g. why a sign-in brought the person back. */
  notice?: ReactNode;
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
  notice,
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
        <SignUpHeader invitationId={invitationId} clientName={clientName} />
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
            changeDisabled={isDetailsPending}
          />
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
        {notice}
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

/**
 * The email from the first step, now fixed: it keeps that field's label and
 * shape so it reads as part of the form, with a way back to edit it.
 */
function ConfirmedEmail({
  email,
  onChange,
  changeDisabled,
}: {
  email: string;
  onChange: (() => void) | undefined;
  changeDisabled: boolean;
}) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const labelId = useId();
  const at = email.lastIndexOf("@");

  return (
    <div className="grid gap-2">
      <span id={labelId} className="text-sm leading-none font-medium">
        {t("Fields.Email.label")}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        data-testid="sign-up-confirmed-email"
        className="flex min-h-10 items-center gap-2 rounded-md border border-input bg-quinary py-1 pr-1 pl-3"
      >
        {/* Never cut off. Each half stays whole while it fits, so a long
            address breaks before the "@" rather than inside the domain. */}
        <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
          {at > 0 ? (
            <>
              <span className="inline-block max-w-full">
                {email.slice(0, at)}
              </span>
              <span className="inline-block max-w-full">{email.slice(at)}</span>
            </>
          ) : (
            email
          )}
        </span>
        {onChange ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-label={t("changeEmail")}
            disabled={changeDisabled}
            onClick={onChange}
          >
            {t("change")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
