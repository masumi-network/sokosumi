"use client";

import type { Account } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ReauthDialog } from "@/components/auth/reauth-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReauthGate } from "@/hooks/use-reauth-gate";
import { authClient } from "@/lib/auth/auth.client";
import {
  SOCIAL_PROVIDER_NAMES,
  type SocialProvider,
} from "@/lib/auth/social-providers";

interface DisconnectModalProps {
  account: Account;
  /** Every linked account, so re-authentication offers the right method. */
  accounts: Account[];
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function DisconnectModal({
  account,
  accounts,
  open,
  setOpen,
}: DisconnectModalProps) {
  const t = useTranslations("App.Account.SocialAccounts.DisconnectModal");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const { providerId } = account;
  const provider =
    SOCIAL_PROVIDER_NAMES[providerId as SocialProvider] ?? providerId;

  const reauthGate = useReauthGate({ accounts });

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  async function handleDisconnect() {
    setLoading(true);

    try {
      const result = await authClient.unlinkAccount({ accountId: account.id });

      if (!result.error) {
        toast.success(t("success"));
        setOpen(false);
        router.refresh();
        return;
      }

      // Core gates unlinking on a fresh session. The gate asks the viewer to
      // authenticate again, then they disconnect again.
      if (reauthGate.handleError(result.error)) {
        // Close this dialog so the two never stack.
        setOpen(false);
        return;
      }

      toast.error(result.error.message ?? t("error", { provider }));
    } catch {
      // A rejected call leaves no result to read, so without this the spinner
      // would clear and the viewer would never learn the account is still on.
      toast.error(t("error", { provider }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOnOpenChange}>
        <DialogContent className="w-[80vw] max-w-md!">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-medium">
              {t("title", { provider })}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-center text-base">
              {t("description", { provider })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex w-full items-center justify-around! gap-1.5">
            <Button
              variant="primary"
              onClick={handleDisconnect}
              loading={loading}
            >
              {t("confirm")}
            </Button>
            <DialogClose asChild>
              <Button variant="secondary" disabled={loading}>
                {t("cancel")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReauthDialog {...reauthGate.dialogProps} />
    </>
  );
}
