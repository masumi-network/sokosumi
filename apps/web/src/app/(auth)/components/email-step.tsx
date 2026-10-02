"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import { isRejectedOAuthRequestError } from "@/lib/auth/auth.utils";
import {
  isSameTabClick,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import type { FormData } from "@/lib/form";
import {
  type EmailStepFormSchemaType,
  emailStepFormSchema,
} from "@/lib/schemas/auth";
import { cn } from "@/lib/utils";

// 200ms ease-out is the project default. Under reduced motion the two states
// swap at once; the notice itself is the cue that something changed.
const MOTION = "duration-200 ease-out motion-reduce:transition-none";

// The detour link takes the exact place of the button that was just pressed.
// A second click of a double-click must not follow it.
const DETOUR_GRACE_MS = 400;

/** Where the step sends a person instead of continuing, and when. */
export interface EmailStepDetour {
  /** Sign-up stops at an address that has an account, sign-in at one without. */
  when: "exists" | "missing";
  title: string;
  description: string;
  label: string;
  href: string;
  /**
   * Work that takes the person there, e.g. emailing a code first. The link
   * spins until it has navigated. A click for another tab just opens `href`.
   */
  follow?: (email: string, signal: AbortSignal) => Promise<void>;
}

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
  onContinue: (email: string, signal: AbortSignal) => Promise<void> | void;
  /** The check the work after Continue needs, shown beside this step's. */
  continueCaptcha?: ReactNode;
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
  continueCaptcha,
  disabled = false,
  onPendingChange,
}: EmailStepProps) {
  const t = useTranslations("Auth.Email.Form");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha(captchaEntry);
  const [isDetoured, setIsDetoured] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  // Set at once, so a second click before the spinner renders is ignored.
  const isFollowingRef = useRef(false);
  const detouredSince = useRef(0);
  const detourLinkRef = useRef<HTMLAnchorElement>(null);
  const noticeId = useId();
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const form = useForm<EmailStepFormSchemaType>({
    resolver: zodResolver(
      emailStepFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: { email: defaultEmail },
  });
  const formData: FormData<EmailStepFormSchemaType, "Auth.Email.Form"> = [
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
  const isPending = isSubmitting || isFollowing;

  // Unmounting mid-run (Continue opens the next step) is no longer pending.
  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  // The pressed button went inert, so focus moves to the one that took its
  // place. A submitting fieldset cannot receive focus; wait until it is
  // enabled again.
  useEffect(() => {
    if (!isDetoured || isSubmitting) return;
    detourLinkRef.current?.focus();
  }, [isDetoured, isSubmitting]);

  async function followDetour(
    email: string,
    follow: NonNullable<EmailStepDetour["follow"]>,
  ) {
    const controller = new AbortController();
    pending.current = controller;
    isFollowingRef.current = true;
    setIsFollowing(true);
    await follow(email, controller.signal);
    // Done, the page is leaving; keep spinning until it has.
    if (!controller.signal.aborted) return;
    isFollowingRef.current = false;
    if (mounted.current) setIsFollowing(false);
  }

  async function handleSubmit({ email }: EmailStepFormSchemaType) {
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
    await runWithCaptcha(async (fetchOptions) => {
      if (!isCurrent()) return;
      const result = await authClient.$fetch<{ exists: boolean }>(
        "/sign-up/email-status",
        { method: "POST", body: { email }, headers: fetchOptions.headers },
      );

      if (!isCurrent()) return;
      if (result.error) {
        // The auth client adds the page's OAuth request to every call, this
        // one included, and Core refuses the call when that request is stale.
        if (isRejectedOAuthRequestError(result.error)) {
          toast.error(oauthT("errorDescription"));
          return;
        }

        // Core puts the captcha's error code on the body; the client types
        // only the transport fields.
        const error: { code?: string; message?: string } = result.error;
        toast.error(getErrorMessage(error, error.message ?? t("error")));
        return;
      }

      if (result.data.exists === (detour.when === "exists")) {
        detouredSince.current = performance.now();
        setIsDetoured(true);
        return;
      }

      await onContinue(email, controller.signal);
    });
  }

  return (
    <BaseForm
      form={form}
      onSubmit={handleSubmit}
      disabled={disabled}
      onChange={() => {
        pending.current?.abort();
        isFollowingRef.current = false;
        setIsFollowing(false);
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
        {isDetoured ? `${detour.title}. ${detour.description}` : null}
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
            <div className="grid gap-0.5 pb-3">
              <p className="font-medium tracking-tight">{detour.title}</p>
              <p className="text-muted-foreground">{detour.description}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {captcha}
          {continueCaptcha}
          {/* Both controls share one cell. The submit button stays underneath
              and the link fades in over it, so the fill never dips. The
              submit button is positioned (for its spinner), so the link must
              be too, or it would paint below. */}
          <div className="grid">
            <SubmitButton
              isSubmitting={isSubmitting}
              spinnerPosition="start"
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
            <Button
              asChild
              variant="primary"
              className={cn(
                "relative col-start-1 row-start-1 w-full transition-[opacity,color,background-color,border-color,box-shadow,transform] motion-reduce:transition-none",
                !isDetoured && "opacity-0",
              )}
            >
              <Link
                ref={detourLinkRef}
                href={detour.href}
                inert={!isDetoured || disabled}
                aria-describedby={isDetoured ? noticeId : undefined}
                aria-busy={isFollowing || undefined}
                aria-disabled={isFollowing || undefined}
                onAuxClick={() => takeAuthEmailHint()}
                onClick={(event) => {
                  const shownFor = performance.now() - detouredSince.current;
                  if (shownFor < DETOUR_GRACE_MS || isFollowingRef.current) {
                    event.preventDefault();
                    return;
                  }
                  const email = emailLocked ? "" : form.getValues("email");
                  if (detour.follow && email && isSameTabClick(event)) {
                    event.preventDefault();
                    void followDetour(email, detour.follow);
                    return;
                  }
                  rememberAuthEmailHintOnClick(event, email);
                  if (isSameTabClick(event)) {
                    isFollowingRef.current = true;
                    setIsFollowing(true);
                  }
                }}
              >
                {isFollowing ? (
                  <Loader2
                    aria-hidden="true"
                    className="absolute top-1/2 left-4 size-4 -translate-y-1/2 animate-spin motion-reduce:animate-pulse"
                  />
                ) : null}
                {detour.label}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </BaseForm>
  );
}
