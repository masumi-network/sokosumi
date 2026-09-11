"use client";

import type { Account } from "@sokosumi/utils";
import { Loader2, Mail } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthErrorCode } from "@/lib/actions/errors/error-codes/auth";
import { authClient, useSession } from "@/lib/auth/auth.client";
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import {
  isSocialProvider,
  SOCIAL_PROVIDER_ICONS,
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
 * email path sends a magic link, which is the only credential a viewer who
 * signed up that way owns: Better Auth's magic-link sign-up creates no
 * `account` row, so such a viewer has neither a password nor a provider. All
 * three end with a fresh session; repeating the gated action is the caller's.
 */
export function ReauthDialog({
  accounts,
  onOpenChange,
  onReauthenticated,
  open,
}: ReauthDialogProps) {
  const t = useTranslations("Components.ReauthDialog");
  const pathname = usePathname();
  const { data: session } = useSession();
  const [password, setPassword] = useState("");
  // Better Auth defaults this to true. Signing in again mints a new session,
  // so without the same choice the dialog would quietly turn a viewer's
  // "do not keep me signed in" into a persistent cookie.
  const [rememberMe, setRememberMe] = useState(true);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Empty until `useSession` resolves, which is why Confirm stays disabled.
  const email = session?.user.email ?? "";
  const hasPasswordAccount = accounts.some(
    (account) => account.providerId === AccountProvider.CREDENTIAL,
  );
  const socialProviders = accounts
    .map((account) => account.providerId)
    .filter(isSocialProvider);
  // Opening a magic link while the address is unproven makes Better Auth
  // delete every linked account and revoke every session
  // (`revokeUnprovenAccountAccess`). Core does not require verification, so
  // an unverified viewer is ordinary and must never be offered this.
  // A magic-link sign-up is created verified, so the path stays open to the
  // viewers who own nothing else.
  const canUseMagicLink = session?.user.emailVerified === true;
  const hasNoMethod =
    !hasPasswordAccount && socialProviders.length === 0 && !canUseMagicLink;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) {
      return;
    }

    if (!nextOpen) {
      setPassword("");
      setErrorMessage(null);
      setMagicLinkSent(false);
    }

    onOpenChange(nextOpen);
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        rememberMe,
      });

      if (result.error) {
        setErrorMessage(describeSignInError(result.error));
        return;
      }

      setPassword("");
      onOpenChange(false);
      onReauthenticated();
    } catch {
      setErrorMessage(t("passwordError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Core rejects any `/sign-in*` for a viewer who has not accepted the terms,
   * with a code and no message. Both sign-in forms branch on it, so the dialog
   * must too, or a correct password reads as wrong.
   */
  const describeSignInError = (error: {
    code?: string;
    message?: string;
  }): string => {
    if (error.code === AuthErrorCode.TERMS_NOT_ACCEPTED) {
      return t("termsNotAccepted");
    }

    return error.message ?? t("passwordError");
  };

  const handleMagicLinkSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: getAbsoluteAuthRedirectUrl(pathname),
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? t("magicLinkError"));
        return;
      }

      setMagicLinkSent(true);
    } catch {
      setErrorMessage(t("magicLinkError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialSubmit = async (provider: SocialProvider) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: getAbsoluteAuthRedirectUrl(pathname),
      });

      if (result.error) {
        setErrorMessage(
          result.error.code === AuthErrorCode.TERMS_NOT_ACCEPTED
            ? t("termsNotAccepted")
            : (result.error.message ?? t("socialError")),
        );
      }
    } catch {
      setErrorMessage(t("socialError"));
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

        {hasPasswordAccount ? (
          <form className="space-y-4" onSubmit={handlePasswordSubmit}>
            <fieldset className="space-y-2" disabled={isSubmitting}>
              <Label htmlFor="reauth-password">{t("passwordLabel")}</Label>
              <Input
                aria-describedby={errorMessage ? "reauth-error" : undefined}
                aria-invalid={errorMessage ? true : undefined}
                autoComplete="current-password"
                data-testid="reauth-field-currentPassword"
                id="reauth-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={rememberMe}
                  id="reauth-remember-me"
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                />
                <Label className="font-normal" htmlFor="reauth-remember-me">
                  {t("rememberMe")}
                </Label>
              </div>
            </fieldset>
            <Button
              className="w-full"
              disabled={
                isSubmitting || email.length === 0 || password.length === 0
              }
              type="submit"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("confirm")}
            </Button>
          </form>
        ) : null}

        {socialProviders.length > 0 ? (
          <div className="space-y-2">
            {hasPasswordAccount ? (
              <p className="text-muted-foreground text-sm">{t("orSocial")}</p>
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

        {canUseMagicLink ? (
          <div className="space-y-2">
            {hasPasswordAccount || socialProviders.length > 0 ? (
              <p className="text-muted-foreground text-sm">{t("orEmail")}</p>
            ) : null}
            {magicLinkSent ? (
              <p className="text-sm" role="status">
                {t("magicLinkSent", { email })}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={isSubmitting || email.length === 0}
              onClick={handleMagicLinkSubmit}
              type="button"
              variant="outline"
            >
              <Mail />
              {magicLinkSent ? t("resendEmail") : t("continueWithEmail")}
            </Button>
          </div>
        ) : null}

        {hasNoMethod ? <p className="text-sm">{t("noMethod")}</p> : null}

        {errorMessage ? (
          // Announced, because submitting leaves focus on the button.
          <p
            className="text-destructive text-sm"
            id="reauth-error"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
