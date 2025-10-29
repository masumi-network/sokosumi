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

import { useInvitationActionsModalContext } from "./invitation-actions-modal-context";

export default function InvitationActionsModal() {
  const t = useTranslations(
    "Components.MembersTable.InvitationActions.CancelModal",
  );

  const { open, setOpen, loading, selectedItem, startAction } =
    useInvitationActionsModalContext();

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  const getDescription = () => {
    if (!selectedItem) return "";
    const { email } = selectedItem;
    return t("description", { email });
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent className="w-[80vw] max-w-lg!">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-medium">
            {t("title")}
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
