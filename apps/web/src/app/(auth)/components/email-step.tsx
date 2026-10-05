"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { useOAuthRequestRejectedToast } from "@/auth/components/use-oauth-request-rejected-toast";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import {
  isSameTabClick,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import type { FormData } from "@/lib/form";
import { type EmailFormSchemaType, emailFormSchema } from "@/lib/schemas/auth";
import { cn } from "@/lib/utils";

// 200ms ease-out is the project default. Under reduced motion the two states
// swap at once; the notice itself is the cue that something changed.
const MOTION = "duration-200 ease-out motion-reduce:transition-none";

// The detour link takes the exact place of the button that was just pressed.
// A second click of a double-click must not follow it.
const DETOUR_GRACE_MS = 400;

/** What Core said about the address, for the step after Continue. */
interface EmailStepAccount {
  /** Sign-in opens on it, since a code could remove an unproven password. */
  hasPassword: boolean;
  /**
   * Stands in for the captcha on the sign-in code sent next, so a visitor
   * Cloudflare wants to see is checked once, not again for the code.
   */
  captchaPass: string;
}

/**
 * Log in's detour: an address without an account turns Continue into a link
 * to Register.
 */
interface EmailStepNoticeDetour {
  title: string;
  description: string;
  label: string;
  href: string;
  /**
   * Takes the person there, e.g. emailing a code first. The link spins until
   * it has navigated. A click for another tab just opens `href`.
   */
  follow: (
    email: string,
    signal: AbortSignal,
    account: EmailStepAccount,
  ) => Promise<void>;
}

/**
 * Register's detour: Continue on an address with an account takes the person
 * to Log in, without a notice.
 */
interface EmailStepHandOver {
  /** Navigates away; Continue spins until the page has gone. */
  handOver: (
    email: string,
    signal: AbortSignal,
    account: EmailStepAccount,
  ) => Promise<void>;
}

/** Where the step sends a person on the wrong page instead of continuing. */
type EmailStepDetour = EmailStepNoticeDetour | EmailStepHandOver;

interface EmailStepProps {
  defaultEmail: string;
  /** An invitation fixes the address; the person can only confirm it. */
  emailLocked: boolean;
  /** Set when the person came back here from the next step. */
  autoFocus: boolean;
  /** `username webauthn` lets the browser offer a passkey in the field. */
  autoComplete: "email" | "username webauthn";
  captchaEntry: "signin" | "signup";
  /** Shown on Continue when this browser last signed in with the email. */
  lastUsedLabel?: string | undefined;
  detour: EmailStepDetour;
  onFormStart: () => void;
  /** The address as typed, for links outside the step that carry it. */
  onEmailChange?: ((email: string) => void) | undefined;
  /** Runs while the button still spins, e.g. to email a code. */
  onContinue: (
    email: string,
    signal: AbortSignal,
    account: EmailStepAccount,
  ) => Promise<void> | void;
  /** Another sign-in is starting, e.g. with Google; the step waits. */
  disabled?: boolean | undefined;
  /** Whether Continue, or following the detour, is still running. */
  onPendingChange?: ((pending: boolean) => void) | undefined;
}

/**
 * The first step of sign-in and sign-up. It asks Core whether the address has
 * an account, so a person on the wrong page is pointed at the right one
 * before typing anything else.
 *
 * When they are, the button stays where it is and a notice grows around it:
 * title and description unfold above, a frame fades in, and the button
 * becomes the way to the other page. Editing the address plays it back.
 * A hand-over skips the notice: Continue goes to the other page itself.
 */
export function EmailStep({
  defaultEmail,
  emailLocked,
  autoFocus,
  autoComplete,
  captchaEntry,
  lastUsedLabel,
  detour,
  onFormStart,
  onEmailChange,
  onContinue,
  disabled = false,
  onPendingChange,
}: EmailStepProps) {
  const t = useTranslations("Auth.Email.Form");
  const toastRejectedOAuthRequest = useOAuthRequestRejectedToast();
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha(captchaEntry);
  const [isDetoured, setIsDetoured] = useState(false);
  const [followingState, setFollowingState] = useState<
    "preparing" | "navigating" | null
  >(null);
  const isFollowing = followingState !== null;
  // Set at once, so a second click before the spinner renders is ignored.
  const isFollowingRef = useRef(false);
  const detouredSince = useRef(0);
  // What Core said about the address the notice is about.
  const detourAccount = useRef<EmailStepAccount | null>(null);
  const detourLinkRef = useRef<HTMLAnchorElement>(null);
  const noticeId = useId();
  const notice = "handOver" in detour ? null : detour;
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const form = useForm<EmailFormSchemaType>({
    resolver: zodResolver(
      emailFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: { email: defaultEmail },
  });
  const formData: FormData<EmailFormSchemaType, "Auth.Email.Form"> = [
    {
      name: "email",
      labelKey: "label",
      type: "email",
      autoComplete,
      disabled: emailLocked,
    },
  ];

  useMountEffect(() => {
    mounted.current = true;
    // The other page hands over the address the person typed there. It is a
    // starting value, not a locked one like an invitation's address.
    const emailHint = takeAuthEmailHint();
    const useHint =
      emailHint !== null && !emailLocked && !form.getValues("email").trim();
    if (useHint) {
      form.setValue("email", emailHint);
      onEmailChange?.(emailHint);
    }
    if (autoFocus || useHint) {
      form.setFocus("email");
    }
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  });

  const { isSubmitting } = form.formState;

  // The pressed button went inert, so focus moves to the one that took its
  // place. A submitting fieldset cannot receive focus; wait until it is
  // enabled again.
  useEffect(() => {
    if (!isDetoured || isSubmitting) return;
    detourLinkRef.current?.focus();
  }, [isDetoured, isSubmitting]);

  // Following the detour and Continue never overlap: the detour only shows
  // once Continue is done. Each tells the parent from the event that changes it.
  function changeFollowing(state: "preparing" | "navigating" | null) {
    setFollowingState(state);
    onPendingChange?.(state !== null);
  }

  async function followDetour(
    email: string,
    follow: EmailStepNoticeDetour["follow"],
    account: EmailStepAccount,
  ) {
    const controller = new AbortController();
    pending.current = controller;
    isFollowingRef.current = true;
    changeFollowing("preparing");
    await follow(email, controller.signal, account);
    if (pending.current !== controller) return;
    // Done, the page is leaving; keep spinning until it has.
    if (!controller.signal.aborted) {
      if (mounted.current) changeFollowing("navigating");
      return;
    }
    isFollowingRef.current = false;
    if (mounted.current) changeFollowing(null);
  }

  async function handleSubmit({ email }: EmailFormSchemaType) {
    if (!mounted.current) return;
    const controller = new AbortController();
    pending.current = controller;
    function isCurrent() {
      return (
        mounted.current &&
        !controller.signal.aborted &&
        form.getValues("email").trim() === email
      );
    }
    onPendingChange?.(true);
    let handedOver = false;
    try {
      await runWithCaptcha(async (fetchOptions) => {
        if (!isCurrent()) return;
        const result = await authClient.$fetch<{
          exists: boolean;
          hasPassword: boolean;
          captchaPass: string;
        }>("/sign-up/email-status", {
          method: "POST",
          body: { email },
          headers: fetchOptions.headers,
        });

        if (!isCurrent()) return;
        if (result.error) {
          // The auth client sends the page's OAuth request with this call too.
          if (toastRejectedOAuthRequest(result.error)) return;

          // Core puts the captcha's error code on the body; the client types
          // only the transport fields.
          const error: { code?: string; message?: string } = result.error;
          toast.error(getErrorMessage(error, error.message ?? t("error")));
          return;
        }

        const account = {
          hasPassword: result.data.hasPassword,
          captchaPass: result.data.captchaPass,
        };
        // Register stops at an address that has an account, Log in at one
        // without.
        const isWrongPage =
          "handOver" in detour ? result.data.exists : !result.data.exists;
        if (isWrongPage) {
          if ("handOver" in detour) {
            await detour.handOver(email, controller.signal, account);
            if (!isCurrent()) return;
            // The page is leaving; keep spinning until it has.
            handedOver = true;
            isFollowingRef.current = true;
            changeFollowing("navigating");
            return;
          }
          detouredSince.current = performance.now();
          detourAccount.current = account;
          setIsDetoured(true);
          return;
        }

        await onContinue(email, controller.signal, account);
      });
    } finally {
      // Also after Continue has swapped this step out for the next one.
      if (!handedOver) onPendingChange?.(false);
    }
  }

  return (
    <BaseForm
      form={form}
      onSubmit={handleSubmit}
      disabled={disabled || followingState === "navigating"}
      onChange={() => {
        pending.current?.abort();
        isFollowingRef.current = false;
        changeFollowing(null);
        // The answer was about the address as it was.
        setIsDetoured(false);
        onFormStart();
        onEmailChange?.(form.getValues("email"));
      }}
    >
      <FormFields form={form} formData={formData} namespace="Auth.Email.Form" />
      {/* Announces the notice. The visible copy below is the same text, so
          it is hidden from assistive technology rather than read twice. */}
      <p id={noticeId} role="status" className="sr-only">
        {isDetoured && notice ? `${notice.title}. ${notice.description}` : null}
      </p>
      <div
        data-testid="email-step-detour"
        data-state={isDetoured ? "open" : "closed"}
        className={cn(
          // A ring, not a border: it takes no space, so the button below is
          // as wide as the field above it while the notice is closed.
          "rounded-lg text-sm ring-1 ring-inset transition-[padding,box-shadow,background-color]",
          MOTION,
          isDetoured
            ? "bg-card px-4 pt-3 pb-4 ring-border"
            : "ring-transparent",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "grid transition-[grid-template-rows,opacity]",
            MOTION,
            isDetoured ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid gap-0.5 pb-3 text-center">
              <p className="font-medium tracking-tight">{notice?.title}</p>
              <p className="text-muted-foreground">{notice?.description}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {captcha}
          {/* Both controls share one cell. The submit button stays underneath
              and the link fades in over it, so the fill never dips. The
              submit button is positioned while it loads (for its bar), so the
              link must be too, or it would paint below. */}
          <div className="grid">
            <SubmitButton
              // A hand-over has no link to spin; Continue does until it leaves.
              isSubmitting={isSubmitting || (isFollowing && !notice)}
              label={t("continueWithEmail")}
              className="col-start-1 row-start-1 w-full"
              inert={isDetoured}
            />
            {lastUsedLabel && !isDetoured ? (
              <span
                aria-hidden="true"
                className="bg-background text-foreground border-border pointer-events-none relative z-10 col-start-1 row-start-1 mr-2 self-center justify-self-end rounded-full border px-2 py-0.5 text-[0.625rem] font-medium"
              >
                {lastUsedLabel}
              </span>
            ) : null}
            {notice ? (
              <Button
                asChild
                variant="primary"
                loading={isFollowing}
                className={cn(
                  "relative col-start-1 row-start-1 w-full transition-[opacity,color,background-color,border-color,box-shadow,transform] motion-reduce:transition-none",
                  !isDetoured && "opacity-0",
                )}
              >
                <Link
                  ref={detourLinkRef}
                  href={notice.href}
                  inert={!isDetoured || disabled}
                  aria-describedby={isDetoured ? noticeId : undefined}
                  onAuxClick={() => takeAuthEmailHint()}
                  onClick={(event) => {
                    const shownFor = performance.now() - detouredSince.current;
                    if (shownFor < DETOUR_GRACE_MS || isFollowingRef.current) {
                      event.preventDefault();
                      return;
                    }
                    const email = emailLocked ? "" : form.getValues("email");
                    const account = detourAccount.current;
                    if (email && account && isSameTabClick(event)) {
                      event.preventDefault();
                      void followDetour(email, notice.follow, account);
                      return;
                    }
                    rememberAuthEmailHintOnClick(event, email);
                    if (isSameTabClick(event)) {
                      isFollowingRef.current = true;
                      changeFollowing("navigating");
                    }
                  }}
                >
                  {notice.label}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </BaseForm>
  );
}
