"use client";

import type { Account } from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

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
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import {
  isSocialProvider,
  SOCIAL_PROVIDER_ICONS,
  type SocialProvider,
} from "@/lib/auth/social-providers";
import { AccountProvider } from "@/lib/auth/types";

/** True when the dialog can offer this viewer at least one method. */
export function canReauthenticateWith(accounts: Account[]): boolean {
  return accounts.some(
    (account) =>
      account.providerId === AccountProvider.CREDENTIAL ||
      isSocialProvider(account.providerId),
  );
}

interface ReauthDialogProps {
  /** The viewer's linked accounts, used to offer only the methods they own. */
  accounts: Account[];
  onOpenChange: (open: boolean) => void;
  /** Runs after a new session exists, so the caller can retry its action. */
  onReauthenticated: () => void;
  open: boolean;
}

/**
 * Asks the viewer to authenticate again so their session becomes fresh.
 *
 * Better Auth measures freshness from `Session.createdAt` and has no endpoint
 * that refreshes it, so a new sign-in is the only way to clear the gate. The
 * password path signs in behind the dialog and keeps the viewer on the page.
 * The social path leaves for the provider and returns to the same route. Both
 * end with a fresh session; repeating the gated action is up to the caller.
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const email = session?.user.email ?? "";
  const hasPasswordAccount = accounts.some(
    (account) => account.providerId === AccountProvider.CREDENTIAL,
  );
  const socialProviders = accounts
    .map((account) => account.providerId)
    .filter(isSocialProvider);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) {
      return;
    }

    if (!nextOpen) {
      setPassword("");
      setErrorMessage(null);
    }

    onOpenChange(nextOpen);
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        setErrorMessage(result.error.message ?? t("passwordError"));
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

  const handleSocialSubmit = async (provider: SocialProvider) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: getAbsoluteAuthRedirectUrl(pathname),
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? t("socialError"));
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
                autoComplete="current-password"
                data-testid="reauth-field-currentPassword"
                id="reauth-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </fieldset>
            <Button
              className="w-full"
              disabled={isSubmitting || password.length === 0}
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

        {errorMessage ? (
          <p className="text-destructive text-sm">{errorMessage}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
