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

interface InvitationActionsDropdownProps {
  invitation: Invitation;
}

export default function InvitationActionsDropdown({
  invitation,
}: InvitationActionsDropdownProps) {
  const t = useTranslations("Components.MembersTable.InvitationActions");
  const { email, organizationId } = invitation;

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"resend" | "cancel" | null>(null);
  const [loading, setLoading] = useState(false);

  const handleResend = async () => {
    setLoading(true);
    setAction("resend");
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
          toast.error(t("Errors.resendError"));
        },
        onSuccess: () => {
          toast.success(t("Successes.resendSuccess"));
        },
      },
    );
    setLoading(false);
    setOpen(false);
    router.refresh();
  };

  const handleCancel = async () => {
    setLoading(true);
    setAction("cancel");
    await authClient.organization.cancelInvitation(
      {
        invitationId: invitation.id,
      },
      {
        onError: ({ error }) => {
          console.log("Failed to cancel invitation", error);
          toast.error(t("Errors.resendError"));
        },
        onSuccess: () => {
          toast.success(t("Successes.resendSuccess"));
        },
      },
    );
    setLoading(false);
    setOpen(false);
    router.refresh();
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
          {loading && action === "resend" && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {t("resend")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={handleCancel}
          disabled={loading}
        >
          {loading && action === "cancel" && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {t("cancel")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
