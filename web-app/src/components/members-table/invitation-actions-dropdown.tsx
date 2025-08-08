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
import { cn } from "@/lib/utils";
import { Invitation, Member } from "@/prisma/generated/client";

import {
  InvitationAction,
  useInvitationActionsModalContext,
} from "./invitation-actions-modal-context";

interface InvitationActionsDropdownProps {
  me: Member;
  invitation: Invitation;
  className?: string;
}

export default function InvitationActionsDropdown({
  me,
  invitation,
  className,
}: InvitationActionsDropdownProps) {
  const t = useTranslations("Components.MembersTable.InvitationActions");
  const { email, organizationId } = invitation;

  const { openActionModal } = useInvitationActionsModalContext();

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleResend = async () => {
    setLoading(true);
    try {
      const result = await authClient.organization.inviteMember({
        email,
        organizationId,
        role: MemberRole.MEMBER,
        resend: true,
      });

      if (result.error) {
        console.error("Failed to resend invitation", result.error);
        toast.error(t("resendError"));
      }

      toast.success(t("resendSuccess"));
      router.refresh();
    } finally {
      setLoading(false);
      setOpen(false);
    }
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

  const isOwnerOrAdmin =
    me.role === MemberRole.OWNER || me.role === MemberRole.ADMIN;

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild disabled={!isOwnerOrAdmin}>
        <Button
          variant="outline"
          size="icon"
          className={cn("p-2!", className)}
          onClick={() => setOpen(true)}
        >
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
