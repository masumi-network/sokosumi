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
  MemberAction,
  useMemberActionsModalContext,
} from "./member-actions-modal-context";

export default function MemberActionsModal() {
  const t = useTranslations("Components.MembersTable.Actions.Modal");

  const {
    open,
    setOpen,
    loading,
    selectedMember,
    selectedAction,
    startAction,
  } = useMemberActionsModalContext();

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  const getTitle = () => {
    if (selectedAction === MemberAction.REMOVE) {
      return t("removeTitle");
    }
    if (selectedAction === MemberAction.CHANGE_TO_ADMIN) {
      return t("changeRoleTitle");
    }
    if (selectedAction === MemberAction.CHANGE_TO_MEMBER) {
      return t("changeRoleTitle");
    }
    return "";
  };

  const getDescription = () => {
    if (!selectedMember) return "";
    const { name } = selectedMember.user;
    if (selectedAction === MemberAction.REMOVE) {
      return t("removeDescription", { member: name });
    }
    if (selectedAction === MemberAction.CHANGE_TO_ADMIN) {
      return t("changeToAdminDescription", { member: name });
    }
    if (selectedAction === MemberAction.CHANGE_TO_MEMBER) {
      return t("changeToMemberDescription", { member: name });
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
