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
  SOCIAL_PROVIDERS,
} from "@/lib/auth/social-providers";
import { AccountProvider } from "@/lib/auth/types";

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
    <div className="flex flex-col divide-y rounded-xl border p-2">
      {SOCIAL_PROVIDERS.map((provider) => {
        const account = socialAccounts.find(
          (account) => account.providerId === provider,
        );

        return (
          <div key={provider} className="flex items-center gap-2 px-2 py-4">
            {SOCIAL_PROVIDER_ICONS[provider]}
            <p className="flex-1">
              {account ? t("connected") : t("notConnected")}
            </p>
            <Button
              disabled={loading}
              variant={account ? "destructive" : "outline"}
              className={loading ? "animate-pulse" : ""}
              size="icon"
              onClick={() => {
                if (account) {
                  handleDisconnectAccount(account);
                } else {
                  handleConnectAccount(provider);
                }
              }}
            >
              {account ? <Unplug /> : <Plug />}
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
