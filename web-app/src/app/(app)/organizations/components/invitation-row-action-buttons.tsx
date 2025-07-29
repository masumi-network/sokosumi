"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { InvitationWithRelations } from "@/lib/db";

import {
  InvitationRowAction,
  useInvitationRowActionsModalContext,
} from "./invitation-row-actions-modal-context";

export default function InvitationRowActionButtons({
  invitation,
}: {
  invitation: InvitationWithRelations;
}) {
  const t = useTranslations("App.Organizations.InvitationActions");
  const { openActionModal } = useInvitationRowActionsModalContext();

  const handleAccept = () => {
    openActionModal(invitation, InvitationRowAction.ACCEPT);
  };

  const handleReject = () => {
    openActionModal(invitation, InvitationRowAction.REJECT);
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={handleAccept}>
        {t("accept")}
      </Button>
      <Button size="sm" variant="outline" onClick={handleReject}>
        {t("reject")}
      </Button>
    </div>
  );
}
