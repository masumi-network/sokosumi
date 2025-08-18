"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { Account } from "@/lib/auth/auth";
import { authClient } from "@/lib/auth/auth.client";

interface DisconnectModalProps {
  account: Account;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function DisconnectModal({
  account,
  open,
  setOpen,
}: DisconnectModalProps) {
  const t = useTranslations("App.Account.SocialAccounts.DisconnectModal");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const { provider } = account;

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    const result = await authClient.unlinkAccount({
      providerId: provider,
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error", { provider });
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
  );
}
