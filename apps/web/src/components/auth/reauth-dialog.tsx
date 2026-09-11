"use client";

import type { Account } from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";

import { GoogleIcon, MicrosoftIcon } from "@/components/social-icons";
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
import { AccountProvider } from "@/lib/auth/types";

type SocialProvider = AccountProvider.GOOGLE | AccountProvider.MICROSOFT;

const SOCIAL_PROVIDER_ICONS: Record<SocialProvider, ReactNode> = {
  [AccountProvider.GOOGLE]: <GoogleIcon />,
  [AccountProvider.MICROSOFT]: <MicrosoftIcon />,
};

/** Provider ids are wire values, so each button label needs its own key. */
const SOCIAL_PROVIDER_LABEL_KEYS: Record<SocialProvider, string> = {
  [AccountProvider.GOOGLE]: "continueWithGoogle",
  [AccountProvider.MICROSOFT]: "continueWithMicrosoft",
};

function isSocialProvider(providerId: string): providerId is SocialProvider {
  return (
    providerId === AccountProvider.GOOGLE ||
    providerId === AccountProvider.MICROSOFT
  );
}

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
  /** Runs just before the social path leaves the page, to record the intent. */
  onBeforeRedirect: () => void;
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
 * The social path leaves for the provider and returns to the same route.
 */
export function ReauthDialog({
  accounts,
  onBeforeRedirect,
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
      // Recorded before the call, because a successful start navigates away.
      onBeforeRedirect();

      const result = await authClient.signIn.social({
        provider,
        callbackURL: getAbsoluteAuthRedirectUrl(pathname),
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? t("socialError"));
        setIsSubmitting(false);
      }
    } catch {
      setErrorMessage(t("socialError"));
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
                {t(SOCIAL_PROVIDER_LABEL_KEYS[provider])}
              </Button>
            ))}
          </div>
        ) : null}

        {hasPasswordAccount || socialProviders.length > 0 ? null : (
          <p className="text-sm">{t("noMethod")}</p>
        )}

        {errorMessage ? (
          <p className="text-destructive text-sm">{errorMessage}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
