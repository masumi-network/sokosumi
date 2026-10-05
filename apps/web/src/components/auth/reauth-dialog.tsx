"use client";

import type { Account } from "@sokosumi/utils";
import { Mail } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth/auth.client";
import {
  discardRetiredAblyRealtimeClientAfterSignIn,
  getAbsoluteAuthRedirectUrl,
} from "@/lib/auth/auth.utils";
import {
  SOCIAL_PROVIDER_ICONS,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "@/lib/auth/social-providers";
import { AccountProvider } from "@/lib/auth/types";

interface ReauthDialogProps {
  /** The viewer's linked accounts, used to offer only the methods they own. */
  accounts: Account[];
  onOpenChange: (open: boolean) => void;
  /**
   * Runs after the password path signs in. The social path leaves the page
   * instead, so it never reaches this.
   */
  onReauthenticated: () => void;
  open: boolean;
}

/**
 * Asks the viewer to authenticate again so their session becomes fresh.
 *
 * Better Auth measures freshness from `Session.createdAt` and has no endpoint
 * that refreshes it, so a new sign-in is the only way to clear the gate. The
 * password path signs in behind the dialog and keeps the viewer on the page.
 * The social path leaves for the provider and returns to the same route. The
 * email path emails a code that is typed back into the dialog, so it also
 * keeps the viewer on the page. It is the only credential a viewer who signed
 * up that way owns: Better Auth's email-code sign-up creates no `account` row,
 * so such a viewer has neither a password nor a provider. All three end with
 * a fresh session; repeating the gated action is the caller's.
 */
export function ReauthDialog({
  accounts,
  onOpenChange,
  onReauthenticated,
  open,
}: ReauthDialogProps) {
  const t = useTranslations("Components.ReauthDialog");
  const pathname = usePathname();
  const { data: session, isPending: isLoadingSession } = useSession();
  const [password, setPassword] = useState("");
  // When the code went out; null until one has.
  const [emailCodeSentAt, setEmailCodeSentAt] = useState<number | null>(null);
  // `fromPassword` keeps the field's invalid marking on the path that owns it.
  // A failed provider or email attempt must not mark an untouched password.
  const [error, setError] = useState<{
    fromPassword: boolean;
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Empty until `useSession` resolves, which is why Confirm stays disabled.
  const email = session?.user.email ?? "";
  const hasPasswordAccount = accounts.some(
    (account) => account.providerId === AccountProvider.CREDENTIAL,
  );
  // One check for both email paths. Tokens are single-use and the widget
  // resets after each, so a visitor Cloudflare wants to see is asked once
  // rather than once per path.
  const captcha = useAuthCaptcha(hasPasswordAccount ? "signin" : "email-code");
  // Read from the provider table rather than from the rows: Better Auth is
  // unique on providerId plus accountId, so two Google links are legal and
  // mapping the rows would render the same button twice under one React key.
  const socialProviders = SOCIAL_PROVIDERS.filter((provider) =>
    accounts.some((account) => account.providerId === provider),
  );
  // Signing in by email while the address is unproven makes Better Auth
  // delete every linked account and revoke every session
  // (`revokeUnprovenAccountAccess`). Core does not require verification, so
  // an unverified viewer is ordinary and must never be offered this.
  // An email-code sign-up is created verified, so the path stays open to the
  // viewers who own nothing else.
  const canUseEmailCode = session?.user.emailVerified === true;
  // Better Auth reports a 401 or a failed first load as resolved-but-null, so
  // this is a third state, not a slow one. Every offer below needs the address
  // the session carries, and none of them can work without it.
  const hasLostSession = !isLoadingSession && session == null;
  const hasNoMethod =
    !hasPasswordAccount && socialProviders.length === 0 && !canUseEmailCode;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) {
      return;
    }

    if (!nextOpen) {
      setPassword("");
      setError(null);
      setEmailCodeSentAt(null);
    }

    onOpenChange(nextOpen);
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await captcha.runWithCaptcha((fetchOptions) =>
        authClient.signIn.email({
          fetchOptions,
          email,
          password,
          // Persistent session cookie (Max-Age). false → Better Auth omits
          // Max-Age; iOS then drops the cookie when it kills the PWA.
          rememberMe: true,
        }),
      );

      if (!result) return;

      if (result.error) {
        setError({
          fromPassword: true,
          message: captcha.getErrorMessage(
            result.error,
            result.error.message ?? t("passwordError"),
          ),
        });
        return;
      }

      setPassword("");
      finishReauthentication();
    } catch {
      setError({ fromPassword: true, message: t("passwordError") });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Both in-place paths end here: the document stays, the session is new. */
  const finishReauthentication = () => {
    // A code may have been sent before the viewer chose the password instead.
    // Leaving its field up would ask for a stale code next time.
    setEmailCodeSentAt(null);
    // This path keeps the document, so a client the Ably singleton retired
    // for the lost session would outlive the session that lost it.
    discardRetiredAblyRealtimeClientAfterSignIn();
    onOpenChange(false);
    onReauthenticated();
  };

  const handleEmailCodeSend = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await captcha.runWithCaptcha((fetchOptions) =>
        authClient.emailOtp.sendVerificationOtp({
          fetchOptions,
          email,
          type: "sign-in",
        }),
      );

      if (!result) return;

      if (result.error) {
        setError({
          fromPassword: false,
          message: captcha.getErrorMessage(
            result.error,
            result.error.message ?? t("emailCodeError"),
          ),
        });
        return;
      }

      setEmailCodeSentAt(Date.now());
    } catch {
      setError({ fromPassword: false, message: t("emailCodeError") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailCodeSubmit = async (code: string) => {
    const result = await authClient.signIn.emailOtp({ email, otp: code });
    if (result.error) {
      return result.error;
    }

    finishReauthentication();
    return undefined;
  };

  const handleSocialSubmit = async (provider: SocialProvider) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: getAbsoluteAuthRedirectUrl(pathname),
      });

      if (result.error) {
        // No terms branch here: Core's after-hook needs a new session, and
        // `/sign-in/social` mints none. The block surfaces on `/callback`.
        setError({
          fromPassword: false,
          message: result.error.message ?? t("socialError"),
        });
      }
    } catch {
      setError({ fromPassword: false, message: t("socialError") });
    } finally {
      // A successful start navigates away, so this only matters when it does
      // not: without it the dialog stays locked and cannot be closed.
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {hasLostSession ? (
          <p className="text-sm">{t("sessionLost")}</p>
        ) : (
          <>
            {hasPasswordAccount ? (
              <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                <fieldset className="space-y-2" disabled={isSubmitting}>
                  <Label htmlFor="reauth-password">{t("passwordLabel")}</Label>
                  <Input
                    aria-describedby={
                      error?.fromPassword ? "reauth-error" : undefined
                    }
                    aria-invalid={error?.fromPassword ? true : undefined}
                    autoComplete="current-password"
                    data-testid="reauth-field-currentPassword"
                    id="reauth-password"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </fieldset>
                {captcha.widget}
                <Button
                  className="w-full"
                  disabled={email.length === 0 || password.length === 0}
                  // Confirm needs the address the session carries, so it is dead
                  // until that resolves. Show it loading rather than broken.
                  loading={isSubmitting || isLoadingSession}
                  type="submit"
                >
                  {t("confirm")}
                </Button>
              </form>
            ) : null}

            {socialProviders.length > 0 ? (
              <div className="space-y-2">
                {hasPasswordAccount ? (
                  <p className="text-muted-foreground text-sm">
                    {t("orSocial")}
                  </p>
                ) : null}
                {socialProviders.map((provider) => (
                  <Button
                    className="w-full"
                    disabled={isSubmitting}
                    key={provider}
                    onClick={() => handleSocialSubmit(provider)}
                    type="button"
                    variant="outline"
                  >
                    {SOCIAL_PROVIDER_ICONS[provider]}
                    {provider === AccountProvider.GOOGLE
                      ? t("continueWithGoogle")
                      : t("continueWithMicrosoft")}
                  </Button>
                ))}
              </div>
            ) : null}

            {canUseEmailCode ? (
              <div className="space-y-2">
                {hasPasswordAccount || socialProviders.length > 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("orEmail")}
                  </p>
                ) : null}
                {/* With a password, the widget sits above Confirm. */}
                {hasPasswordAccount ? null : captcha.widget}
                {emailCodeSentAt !== null ? (
                  <EmailCodeForm
                    email={email}
                    sentAt={emailCodeSentAt}
                    submitLabel={t("confirmCode")}
                    onSubmitCode={handleEmailCodeSubmit}
                    onResend={() => {
                      void handleEmailCodeSend();
                    }}
                    isResending={isSubmitting}
                  />
                ) : (
                  <Button
                    className="w-full"
                    disabled={isSubmitting || email.length === 0}
                    onClick={() => {
                      void handleEmailCodeSend();
                    }}
                    type="button"
                    variant="outline"
                  >
                    <Mail />
                    {t("continueWithEmail")}
                  </Button>
                )}
              </div>
            ) : null}

            {/* The session decides whether email is on offer, so before it
              resolves every viewer looks like they own nothing. */}
            {hasNoMethod && !isLoadingSession ? (
              <p className="text-sm">{t("noMethod")}</p>
            ) : null}

            {error ? (
              // Announced, because submitting leaves focus on the button.
              <p
                className="text-destructive text-sm"
                id="reauth-error"
                role="alert"
              >
                {error.message}
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
