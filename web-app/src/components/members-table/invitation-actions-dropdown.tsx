import { Ellipsis, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/auth.client";
import { MemberRole } from "@/lib/db";
import { Invitation } from "@/prisma/generated/client";

import {
  InvitationAction,
  useInvitationActionsModalContext,
} from "./invitation-actions-modal-context";

interface InvitationActionsDropdownProps {
  invitation: Invitation;
}

export default function InvitationActionsDropdown({
  invitation,
}: InvitationActionsDropdownProps) {
  const t = useTranslations("Components.MembersTable.InvitationActions");
  const { email, organizationId } = invitation;

  const { openActionModal } = useInvitationActionsModalContext();

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleResend = async () => {
    setLoading(true);
    await authClient.organization.inviteMember(
      {
        email,
        organizationId,
        role: MemberRole.MEMBER,
        resend: true,
      },
      {
        onError: ({ error }) => {
          console.error("Failed to resend invitation", error);
          toast.error(t("resendError"));
        },
        onSuccess: () => {
          toast.success(t("resendSuccess"));
          router.refresh();
        },
      },
    );
    setLoading(false);
    setOpen(false);
  };

  const handleCancel = () => {
    openActionModal(invitation, InvitationAction.CANCEL);
  };

  const handleOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" onClick={() => setOpen(true)}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={handleResend} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("resend")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={handleCancel}
          disabled={loading}
        >
          {t("cancel")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
