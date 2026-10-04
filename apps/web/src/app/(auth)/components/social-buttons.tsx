"use client";

import { track } from "@vercel/analytics";
import { KeyRound, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  GoogleLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import {
  buildAuthCallbackUrl,
  buildAuthErrorCallbackUrl,
  buildOAuthResumeUrlFromSearchParams,
} from "@/lib/auth/auth.utils";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";
import { cn } from "@/lib/utils";
import type { ProviderAuthMethod } from "@/lib/utils/last-used-auth-method";

type SocialButtonProviderId = Exclude<ProviderAuthMethod, "passkey">;

interface SocialButtonsProps {
  returnUrl?: string;
  lastUsedMethod?: ProviderAuthMethod | null;
  showPasskey?: boolean;
  /** Which intent the provider buttons report to Vercel Analytics. */
  eventType?: "signIn" | "signUp";
  /** Another sign-in is starting, e.g. with the email; every button waits. */
  disabled?: boolean;
  /** Whether a sign-in started here is still running. */
  onPendingChange?: (pending: boolean) => void;
}

/** Stands in for the provider's logo while its sign-in starts, at the logo's size. */
function SocialButtonSpinner({
  size,
}: {
  size: string | number;
  color: string;
}) {
  return (
    <Loader2
      aria-hidden="true"
      size={size}
      className="animate-spin motion-reduce:animate-pulse"
    />
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
  lastUsedMethod = null,
  showPasskey = false,
  eventType = "signIn",
  disabled = false,
  onPendingChange,
}: SocialButtonsProps = {}) {
  const t = useTranslations("Auth.SocialButtons");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
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
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) changePendingMethod(null);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const finishPasskeySignIn = useCallback(
    (result: unknown) =>
      finishAuthInPlace({
        eventType: "signIn",
        provider: "passkey",
        returnUrl: effectiveReturnUrl,
        result,
      }),
    [effectiveReturnUrl],
  );

  const handlePasskeySignIn = async (options?: {
    autoFill?: boolean;
    showErrors?: boolean;
  }) => {
    const { autoFill = false, showErrors = true } = options ?? {};

    if (!autoFill) {
      track("Sign In", { provider: "passkey", direct_signup_link: false });
      changePendingMethod("passkey");
    }

    try {
      const result = await authClient.signIn.passkey({
        autoFill,
      });

      if (result.error) {
        const errorCode =
          "code" in result.error ? result.error.code : undefined;

        if (showErrors && !isPasskeyPromptDismissed(errorCode)) {
          toast.error(t("passkeyError"));
        }
        return;
      }

      await finishPasskeySignIn(result.data);
    } catch (_error) {
      if (showErrors) {
        toast.error(t("passkeyError"));
      }
    } finally {
      if (!autoFill) {
        changePendingMethod(null);
      }
    }
  };

  useEffect(() => {
    if (!showPasskey) {
      return;
    }

    if (
      typeof window === "undefined" ||
      typeof window.PublicKeyCredential === "undefined" ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
    ) {
      return;
    }

    let isMounted = true;

    const startConditionalPasskeySignIn = async () => {
      try {
        const isAvailable =
          await PublicKeyCredential.isConditionalMediationAvailable();
        if (!isMounted || !isAvailable) {
          return;
        }

        const result = await authClient.signIn.passkey({
          autoFill: true,
        });
        if (!isMounted || result.error) {
          return;
        }

        await finishPasskeySignIn(result.data);
      } catch {
        return undefined;
      }
    };

    void startConditionalPasskeySignIn();

    return () => {
      isMounted = false;
    };
  }, [finishPasskeySignIn, showPasskey]);

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
        callbackURL: buildAuthCallbackUrl(
          "/auth/callback/signin",
          key,
          effectiveReturnUrl,
        ),
        newUserCallbackURL: buildAuthCallbackUrl(
          "/auth/callback/signup",
          key,
          effectiveReturnUrl,
        ),
        errorCallbackURL: buildAuthErrorCallbackUrl(),
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

        return (
          <div className="group/provider relative" key={socialButton.key}>
            {isLastUsed && (
              <span
                aria-hidden="true"
                className="text-primary pointer-events-none absolute top-1.5 right-2 z-10 text-[0.625rem] font-medium group-has-[:disabled]/provider:opacity-50"
              >
                {t("lastUsed")}
              </span>
            )}
            <socialButton.Button
              onClick={() => handleClick(socialButton.key)}
              disabled={isWaiting}
              {...(pendingMethod === socialButton.key && {
                icon: SocialButtonSpinner,
              })}
              className={cn(
                "text-foreground! m-0! flex h-[50px]! w-full! rounded-md! border! px-4! py-2! text-sm! shadow-none! transition-colors! duration-300! disabled:pointer-events-none! disabled:opacity-50! [&>div]:justify-center! [&>div]:gap-2! [&>div_div]:w-auto!",
                isLastUsed
                  ? "border-primary-tertiary! bg-primary-quinary! hover:bg-primary-quaternary!"
                  : "bg-senary! hover:bg-quinary! border-transparent!",
              )}
              align="center"
              text={t("continueWith", { provider: socialButton.name })}
            />
          </div>
        );
      })}
      {showPasskey && (
        <div className="group/provider relative">
          {lastUsedMethod === "passkey" && (
            <span
              aria-hidden="true"
              className="text-primary pointer-events-none absolute top-1.5 right-2 z-10 text-[0.625rem] font-medium group-has-[:disabled]/provider:opacity-50"
            >
              {t("lastUsed")}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            className={cn(
              "text-foreground h-[50px] w-full justify-center gap-2 rounded-md border px-4 py-2 text-sm font-normal shadow-none",
              lastUsedMethod === "passkey"
                ? "border-primary-tertiary bg-primary-quinary hover:bg-primary-quaternary"
                : "bg-senary hover:bg-quinary border-transparent",
            )}
            disabled={isWaiting}
            onClick={() => {
              void handlePasskeySignIn();
            }}
          >
            {pendingMethod === "passkey" ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
            ) : (
              <KeyRound className="size-4" />
            )}
            {t("continueWith", { provider: t("passkeyProvider") })}
          </Button>
        </div>
      )}
    </div>
  );
}
