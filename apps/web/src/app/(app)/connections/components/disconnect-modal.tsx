"use client";

import type { Account } from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
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
import { isSessionNotFreshError } from "@/lib/actions/errors/better-auth";
import { authClient } from "@/lib/auth/auth.client";
import { unlinkSocialAccountInput } from "@/lib/auth/unlink-social-account";

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
  const [isReauthOpen, setIsReauthOpen] = useState(false);

  const { providerId } = account;

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    const result = await authClient.unlinkAccount(
      unlinkSocialAccountInput(account),
    );
    if (result.error) {
      // Core gates unlinking on a fresh session. Ask the person to
      // authenticate again, then run this handler a second time.
      if (isSessionNotFreshError(result.error)) {
        setLoading(false);
        // Close this dialog first so the two never stack.
        setOpen(false);
        setIsReauthOpen(true);
        return;
      }

      const errorMessage =
        result.error.message ?? t("error", { provider: providerId });
      toast.error(errorMessage);
      setLoading(false);
    } else {
      toast.success(t("success"));
      setLoading(false);
      setOpen(false);
      router.refresh();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOnOpenChange}>
        <DialogContent className="w-[80vw] max-w-md!">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-medium">
              {t("title", { provider: providerId })}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-center text-base">
              {t("description", { provider: providerId })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex w-full items-center justify-around! gap-1.5">
            <Button
              variant="primary"
              onClick={handleDisconnect}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
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
      <ReauthDialog
        accounts={accounts}
        onOpenChange={setIsReauthOpen}
        onReauthenticated={() => {
          void handleDisconnect();
        }}
        open={isReauthOpen}
      />
    </>
  );
}
