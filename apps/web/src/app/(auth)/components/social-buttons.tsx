"use client";

import * as Sentry from "@sentry/nextjs";
import { track } from "@vercel/analytics";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentProps,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth.client";
import {
  buildAuthCallbackUrl,
  buildOAuthConsentReturnUrlFromSearchParams,
  createAuthSessionGetter,
  getAbsoluteAuthRedirectUrl,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";
import { emailSchema } from "@/lib/auth/data";
import { cn } from "@/lib/utils";

export type SocialButtonProviderId = "google" | "microsoft";
export type SignInMethodId = SocialButtonProviderId | "passkey" | "magic-link";

interface SocialButtonsProps {
  returnUrl?: string;
  lastUsedMethod?: SignInMethodId | null;
  prefilledEmail?: string;
  showMagicLink?: boolean;
  showPasskey?: boolean;
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

export default function SocialButtons({
  returnUrl,
  lastUsedMethod = null,
  prefilledEmail,
  showMagicLink = false,
  showPasskey = false,
}: SocialButtonsProps = {}) {
  const t = useTranslations("Auth.SocialButtons");
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthConsentReturnUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const [magicLinkEmail, setMagicLinkEmail] = useState(prefilledEmail ?? "");
  const [isMagicLinkVisible, setIsMagicLinkVisible] = useState(false);
  const [isRequestingMagicLink, setIsRequestingMagicLink] = useState(false);
  const [isSigningInWithPasskey, setIsSigningInWithPasskey] = useState(false);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  const hasMagicLinkSuccess =
    magicLinkEmail.trim().length > 0 &&
    magicLinkEmail.trim() === magicLinkSentTo;

  const finishPasskeySignIn = useCallback(async () => {
    await waitForAuthSession({
      context: "login",
      getSession: createAuthSessionGetter(() => authClient.getSession()),
      logWarning: (message) => {
        Sentry.captureMessage(message, { level: "warning" });
      },
    });

    router.replace(normalizeAuthReturnUrl(effectiveReturnUrl));
  }, [effectiveReturnUrl, router]);

  const handlePasskeySignIn = async (options?: {
    autoFill?: boolean;
    showErrors?: boolean;
  }) => {
    const { autoFill = false, showErrors = true } = options ?? {};

    if (!autoFill) {
      track("Sign In", { provider: "passkey", direct_signup_link: false });
      setIsSigningInWithPasskey(true);
    }

    try {
      const result = await authClient.signIn.passkey({
        autoFill,
      });

      if (result.error) {
        const errorCode =
          "code" in result.error ? result.error.code : undefined;

        if (showErrors && errorCode !== "AUTH_CANCELLED") {
          toast.error(t("passkeyError"));
        }
        return;
      }

      await finishPasskeySignIn();
    } catch (_error) {
      if (showErrors) {
        toast.error(t("passkeyError"));
      }
    } finally {
      if (!autoFill) {
        setIsSigningInWithPasskey(false);
      }
    }
  };

  const finishPasskeySignInRef = useRef(finishPasskeySignIn);
  finishPasskeySignInRef.current = finishPasskeySignIn;

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
    let hasStartedConditionalAutofill = false;

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

        await finishPasskeySignInRef.current();
      } catch {
        return undefined;
      }
    };

    const handleEmailFocusIn = (event: FocusEvent) => {
      if (hasStartedConditionalAutofill || !isMounted) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!target.matches('input[data-testid="auth-field-email"]')) {
        return;
      }

      hasStartedConditionalAutofill = true;
      void startConditionalPasskeySignIn();
    };

    document.addEventListener("focusin", handleEmailFocusIn);

    return () => {
      isMounted = false;
      document.removeEventListener("focusin", handleEmailFocusIn);
    };
  }, [showPasskey]);

  const handleMagicLinkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmail = magicLinkEmail.trim();
    if (!emailSchema().safeParse(trimmedEmail).success) {
      toast.error(t("magicLinkInvalidEmail"));
      return;
    }

    track("Sign In", { provider: "magic-link", direct_signup_link: false });
    setIsRequestingMagicLink(true);

    try {
      const result = await authClient.signIn.magicLink({
        email: trimmedEmail,
        callbackURL: getAbsoluteAuthRedirectUrl(effectiveReturnUrl, "/"),
      });

      if (result.error) {
        toast.error(result.error.message ?? t("magicLinkError"));
        return;
      }

      setMagicLinkSentTo(trimmedEmail);
    } catch (_error) {
      toast.error(t("magicLinkError"));
    } finally {
      setIsRequestingMagicLink(false);
    }
  };

  const handleMagicLinkClick = () => {
    setIsMagicLinkVisible((currentValue) => !currentValue);
  };

  const handleClick = async (key: SocialButtonProviderId) => {
    track("Sign In", { provider: key, direct_signup_link: false });

    const result = await authClient.signIn.social({
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
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      toast.error(errorMessage);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {socialButtons.map((socialButton) => {
        const isLastUsed = lastUsedMethod === socialButton.key;

        return (
          <div className="relative" key={socialButton.key}>
            {isLastUsed && (
              <span
                aria-hidden="true"
                className="text-primary/70 pointer-events-none absolute top-1.5 right-2 z-10 text-[0.625rem] font-medium"
              >
                {t("lastUsed")}
              </span>
            )}
            <socialButton.Button
              onClick={() => handleClick(socialButton.key)}
              className={cn(
                "text-foreground! m-0! flex h-[50px]! w-full! rounded-md! border! px-4! py-2! text-sm! shadow-none! transition-colors! duration-300! [&>div]:justify-center! [&>div]:gap-2! [&>div_div]:w-auto!",
                isLastUsed
                  ? "border-primary/60! bg-primary/10! hover:bg-primary/15! dark:bg-primary/15! dark:hover:bg-primary/20!"
                  : "bg-senary! hover:bg-quinary! border-transparent!",
              )}
              align="center"
              text={t("continueWith", { provider: socialButton.name })}
            />
          </div>
        );
      })}
      {showPasskey && (
        <div className="relative">
          {lastUsedMethod === "passkey" && (
            <span
              aria-hidden="true"
              className="text-primary/70 pointer-events-none absolute top-1.5 right-2 z-10 text-[0.625rem] font-medium"
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
                ? "border-primary/60 bg-primary/10 hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20"
                : "bg-senary hover:bg-quinary border-transparent",
            )}
            disabled={isSigningInWithPasskey}
            onClick={() => {
              void handlePasskeySignIn();
            }}
          >
            {isSigningInWithPasskey ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            {t("continueWith", { provider: t("passkeyProvider") })}
          </Button>
        </div>
      )}
      {showMagicLink && (
        <div className="relative">
          {lastUsedMethod === "magic-link" && (
            <span
              aria-hidden="true"
              className="text-primary/70 pointer-events-none absolute top-1.5 right-2 z-10 text-[0.625rem] font-medium"
            >
              {t("lastUsed")}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            className={cn(
              "text-foreground h-[50px] w-full justify-center gap-2 rounded-md border px-4 py-2 text-sm font-normal shadow-none",
              lastUsedMethod === "magic-link"
                ? "border-primary/60 bg-primary/10 hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20"
                : "bg-senary hover:bg-quinary border-transparent",
            )}
            onClick={handleMagicLinkClick}
          >
            <Mail className="size-4" />
            {t("continueWith", { provider: t("magicLinkProvider") })}
          </Button>
        </div>
      )}
      {showMagicLink && isMagicLinkVisible && (
        <form
          className="bg-muted/30 flex flex-col gap-2 rounded-md border p-4"
          onSubmit={handleMagicLinkSubmit}
        >
          {hasMagicLinkSuccess && (
            <p className="text-muted-foreground text-center text-sm">
              {t("magicLinkSuccess")}
            </p>
          )}
          <Input
            type="email"
            className="text-center placeholder:text-center"
            value={magicLinkEmail}
            onChange={(event) => {
              setMagicLinkEmail(event.target.value);
            }}
            placeholder={t("magicLinkPlaceholder")}
            aria-label={t("magicLinkInputLabel")}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isRequestingMagicLink}
          >
            {isRequestingMagicLink
              ? t("magicLinkSubmitting")
              : hasMagicLinkSuccess
                ? t("magicLinkResend")
                : t("magicLinkSubmit")}
          </Button>
        </form>
      )}
    </div>
  );
}
