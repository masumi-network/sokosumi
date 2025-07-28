"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

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

import {
  InvitationRowAction,
  useInvitationRowActionsModalContext,
} from "./invitation-row-actions-modal-context";

export default function InvitationRowActionsModal() {
  const t = useTranslations("App.Organizations.InvitationActions");

  const { open, setOpen, loading, selectedItem, selectedAction, startAction } =
    useInvitationRowActionsModalContext();

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  const getTitle = () => {
    if (selectedAction === InvitationRowAction.ACCEPT) {
      return t("acceptTitle");
    }
    if (selectedAction === InvitationRowAction.REJECT) {
      return t("rejectTitle");
    }
    return "";
  };

  const getDescription = () => {
    if (!selectedItem) return "";
    const { email } = selectedItem;
    if (selectedAction === InvitationRowAction.ACCEPT) {
      return t("acceptDescription", { email });
    }
    if (selectedAction === InvitationRowAction.REJECT) {
      return t("rejectDescription", { email });
    }
    return "";
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent className="w-[80vw] max-w-lg!">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-medium">
            {getTitle()}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-center text-base">
            {getDescription()}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="block space-y-1.5">
          <Button
            variant="primary"
            className="w-full"
            onClick={startAction}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("confirm")}
          </Button>
          <DialogClose asChild>
            <Button variant="secondary" className="w-full" disabled={loading}>
              {t("cancel")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
