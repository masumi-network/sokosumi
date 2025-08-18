"use client";

import { Plug, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { GoogleIcon, MicrosoftIcon } from "@/components/social-icons";
import { Button } from "@/components/ui/button";
import { type Account } from "@/lib/auth/auth";
import { authClient } from "@/lib/auth/auth.client";
import { AccountProvider } from "@/lib/auth/types";

import DisconnectModal from "./disconnect-modal";

interface SocialAccountsProps {
  socialAccounts: Account[];
}

const socialIconMaps: Record<AccountProvider, React.ReactNode> = {
  [AccountProvider.GOOGLE]: <GoogleIcon />,
  [AccountProvider.MICROSOFT]: <MicrosoftIcon />,
  [AccountProvider.CREDENTIAL]: null,
};

const supportedSocialProviders = [
  AccountProvider.GOOGLE,
  AccountProvider.MICROSOFT,
];

export function SocialAccounts({ socialAccounts }: SocialAccountsProps) {
  const t = useTranslations("App.Account.SocialAccounts");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  const handleConnectAccount = async (provider: AccountProvider) => {
    setLoading(true);
    const result = await authClient.linkSocial({
      provider,
      callbackURL: "/account",
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
      {supportedSocialProviders.map((provider) => {
        const account = socialAccounts.find(
          (account) => account.provider === provider,
        );

        return (
          <div key={provider} className="flex items-center gap-2 px-2 py-4">
            {socialIconMaps[provider]}
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
        <DisconnectModal account={account} open={open} setOpen={setOpen} />
      )}
    </div>
  );
}
