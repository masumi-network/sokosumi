"use client";

import { track } from "@vercel/analytics";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useCallback, useState } from "react";
import {
  GoogleLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
import { useConditionalPasskeyAutofill } from "@/hooks/effects/use-conditional-passkey-autofill";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { authClient } from "@/lib/auth/auth.client";
import { buildSocialCallbackUrls } from "@/lib/auth/auth.utils";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";
import { cn } from "@/lib/utils";
import type {
  LastUsedAuthMethod,
  ProviderAuthMethod,
} from "@/lib/utils/last-used-auth-method";

type SocialButtonProviderId = Exclude<ProviderAuthMethod, "passkey">;

interface SocialButtonsProps {
  /**
   * Where a sign-in started here ends: `AuthFlow`'s return URL, which falls
   * back to resuming the page's OAuth request.
   */
  returnUrl?: string;
  lastUsedMethod?: LastUsedAuthMethod | null;
  showPasskey?: boolean;
  /** Which intent the provider buttons report to Vercel Analytics. */
  eventType?: "signIn" | "signUp";
  /** Another sign-in is starting, e.g. with the email; every button waits. */
  disabled?: boolean;
  /** Whether a sign-in started here is still running. */
  onPendingChange?: (pending: boolean) => void;
}

/**
 * Marks the method used last: the email field's pill, on its own row above
 * the button, so it never shares space with a label that is long (Spanish,
 * German) or wraps on a narrow phone.
 */
function LastUsedBadge({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="bg-background text-foreground border-border pointer-events-none mr-2 mb-1 self-end rounded-full border px-2 py-0.5 text-2xs leading-none font-medium group-has-[:disabled]/provider:opacity-50"
    >
      {label}
    </span>
  );
}

const socialButtons: Array<{
  key: SocialButtonProviderId;
  name: string;
  Button: React.FC<ComponentProps<typeof GoogleLoginButton>>;
}> = [
  {
    key: "google",
    name: "Google",
    Button: GoogleLoginButton,
  },
  {
    key: "microsoft",
    name: "Microsoft",
    Button: MicrosoftLoginButton,
  },
];

/**
 * The person closed the browser's passkey prompt, let it time out, or another
 * prompt replaced it. Better Auth passes simplewebauthn's code on without the
 * underlying error, so a `NotAllowedError` (the passthrough code) cannot be
 * told apart further; by spec it means cancelled, timed out or not permitted.
 */
function isPasskeyPromptDismissed(code: string | undefined): boolean {
  return (
    code === "AUTH_CANCELLED" ||
    code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" ||
    code === "ERROR_CEREMONY_ABORTED"
  );
}

export default function SocialButtons({
  returnUrl,
  lastUsedMethod,
  showPasskey,
  eventType,
  disabled,
  onPendingChange,
}: SocialButtonsProps) {
  const t = useTranslations("Auth.SocialButtons");
  // The sign-in that is starting. Every button waits while one runs.
  const [pendingMethod, setPendingMethod] = useState<ProviderAuthMethod | null>(
    null,
  );

  const isWaiting = pendingMethod !== null || disabled;

  // Every change goes through here, so the parent hears it from the same event.
  function changePendingMethod(method: ProviderAuthMethod | null) {
    setPendingMethod(method);
    onPendingChange?.(method !== null);
  }

  // Back from the provider restores this page as it was left, mid sign-in.
  useEventListener("window", "pageshow", (event) => {
    if (event.persisted) changePendingMethod(null);
  });

  const finishPasskeySignIn = useCallback(
    (result: unknown) =>
      finishAuthInPlace({
        eventType: "signIn",
        provider: "passkey",
        returnUrl,
        result,
      }),
    [returnUrl],
  );

  const handlePasskeySignIn = async () => {
    track("Sign In", { provider: "passkey", direct_signup_link: false });
    changePendingMethod("passkey");

    try {
      const result = await authClient.signIn.passkey();

      if (result.error) {
        const errorCode =
          "code" in result.error ? result.error.code : undefined;

        if (!isPasskeyPromptDismissed(errorCode)) {
          toast.error(t("passkeyError"));
        }
        return;
      }

      await finishPasskeySignIn(result.data);
    } catch {
      toast.error(t("passkeyError"));
    } finally {
      changePendingMethod(null);
    }
  };

  useConditionalPasskeyAutofill(showPasskey, finishPasskeySignIn);

  const handleClick = async (key: SocialButtonProviderId) => {
    if (isWaiting) return;
    changePendingMethod(key);
    track(eventType === "signUp" ? "Sign Up" : "Sign In", {
      provider: key,
      direct_signup_link: false,
    });

    // On success the browser leaves for the provider, so the buttons stay busy.
    const result = await authClient.signIn
      .social({
        provider: key,
        ...buildSocialCallbackUrls(key, returnUrl),
      })
      .catch(() => ({ error: { message: undefined } }));
    if (result.error) {
      changePendingMethod(null);
      const errorMessage = result.error.message ?? t("error");
      toast.error(errorMessage);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {socialButtons.map((socialButton) => {
        const isLastUsed = lastUsedMethod === socialButton.key;
        const isPending = pendingMethod === socialButton.key;

        return (
          <div
            className={cn(
              "group/provider relative flex flex-col",
              // The provider button is third-party, so it cannot take
              // `loading`: draw the same bar over it and keep its logo.
              isPending && "text-foreground overflow-hidden rounded-md",
            )}
            aria-busy={isPending || undefined}
            key={socialButton.key}
          >
            {isLastUsed && <LastUsedBadge label={t("lastUsed")} />}
            <socialButton.Button
              onClick={() => handleClick(socialButton.key)}
              // The pending one stays enabled, so it keeps focus and full
              // contrast; handleClick already ignores clicks while waiting.
              disabled={isWaiting && !isPending}
              className={cn(
                "text-foreground! m-0! flex h-auto! min-h-10! w-full! rounded-md! border! px-4! py-2! text-sm! shadow-none! transition-colors! duration-300! disabled:pointer-events-none! disabled:opacity-50! [&>div]:justify-center! [&>div]:gap-2! [&>div_div]:w-auto!",
                isPending && "cursor-progress!",
                isLastUsed
                  ? "border-border! bg-muted! hover:bg-quinary!"
                  : "bg-senary! hover:bg-quinary! border-transparent!",
              )}
              align="center"
              text={t("continueWith", { provider: socialButton.name })}
            />
            {isPending && (
              <ButtonLoadingBar
                label={t("continueWith", { provider: socialButton.name })}
              />
            )}
          </div>
        );
      })}
      {showPasskey && (
        <div className="group/provider relative flex flex-col">
          {lastUsedMethod === "passkey" && (
            <LastUsedBadge label={t("lastUsed")} />
          )}
          <Button
            type="button"
            variant="secondary"
            className={cn(
              "text-foreground h-10 w-full justify-center gap-2 rounded-md border px-4 py-2 text-sm font-normal shadow-none",
              lastUsedMethod === "passkey"
                ? "border-border bg-muted hover:bg-quinary"
                : "bg-senary hover:bg-quinary border-transparent",
            )}
            disabled={isWaiting}
            loading={pendingMethod === "passkey"}
            onClick={() => {
              void handlePasskeySignIn();
            }}
          >
            <KeyRound className="size-4" />
            {t("continueWith", { provider: t("passkeyProvider") })}
          </Button>
        </div>
      )}
    </div>
  );
}
