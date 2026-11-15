"use client";

import type { Account } from "@sokosumi/utils";
import { Plug, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import {
  SOCIAL_PROVIDER_ICONS,
  SOCIAL_PROVIDER_NAMES,
  SOCIAL_PROVIDERS,
} from "@/lib/auth/social-providers";
import { AccountProvider } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

import DisconnectModal from "./disconnect-modal";

interface SocialAccountsProps {
  /** Every linked account, including the credential one. */
  accounts: Account[];
}

export function SocialAccounts({ accounts }: SocialAccountsProps) {
  const socialAccounts = accounts.filter(
    (account) => account.providerId !== AccountProvider.CREDENTIAL,
  );
  const t = useTranslations("App.Account.SocialAccounts");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  const handleConnectAccount = async (provider: AccountProvider) => {
    setLoading(true);
    const result = await authClient.linkSocial({
      provider,
      callbackURL: getAbsoluteAuthRedirectUrl("/connections"),
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error", { provider });
      toast.error(errorMessage);
    }
    setLoading(false);
  };

  const handleDisconnectAccount = (account: Account) => {
    setAccount(account);
    setOpen(true);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {SOCIAL_PROVIDERS.map((provider) => {
        const account = socialAccounts.find(
          (account) => account.providerId === provider,
        );
        const name = SOCIAL_PROVIDER_NAMES[provider];

        return (
          <div
            key={provider}
            className="bg-card flex items-center gap-3 rounded-xl border p-4"
          >
            <span className="bg-background flex size-10 shrink-0 items-center justify-center rounded-lg border [&>svg]:size-5">
              {SOCIAL_PROVIDER_ICONS[provider]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                {name}
                {account ? (
                  <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium">
                    <span
                      aria-hidden
                      className="bg-status-success size-1.5 rounded-full"
                    />
                    {t("statusConnected")}
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {t(account ? "hintConnected" : "hintNotConnected", {
                  provider: name,
                })}
              </p>
            </div>
            {/* Bordered Connect, quiet Disconnect: a filled button marks a
                view's one primary action, and two providers would share it. */}
            <Button
              disabled={loading}
              variant={account ? "ghost" : "outline"}
              size="sm"
              className={cn("shrink-0", loading && "animate-pulse")}
              aria-label={t(account ? "disconnect" : "connect", {
                provider: name,
              })}
              onClick={() => {
                if (account) {
                  handleDisconnectAccount(account);
                } else {
                  handleConnectAccount(provider);
                }
              }}
            >
              {account ? <Unplug aria-hidden /> : <Plug aria-hidden />}
              {t(account ? "disconnectAction" : "connectAction")}
            </Button>
          </div>
        );
      })}
      {account && (
        <DisconnectModal
          account={account}
          accounts={accounts}
          open={open}
          setOpen={setOpen}
        />
      )}
    </div>
  );
}
