"use client";

import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import { InvitationWithRelations } from "@/lib/db";

export default function InvitationRowActionButtons({
  invitation,
}: {
  invitation: InvitationWithRelations;
}) {
  const t = useTranslations("App.Organizations.InvitationActions");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "reject" | null>(null);

  const handleAccept = async () => {
    if (loading) return;

    try {
      setLoading(true);
      setAction("accept");

      const result = await authClient.organization.acceptInvitation({
        invitationId: invitation.id,
      });

      if (result.error) {
        console.error("Failed to accept invitation", result.error);
        toast.error(t("acceptError"));
        return;
      }

      toast.success(t("acceptSuccess"));
      router.refresh();
    } catch (error) {
      console.error("Error accepting invitation:", error);
      toast.error(t("acceptError"));
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const handleReject = async () => {
    if (loading) return;

    try {
      setLoading(true);
      setAction("reject");

      const result = await authClient.organization.rejectInvitation({
        invitationId: invitation.id,
      });

      if (result.error) {
        console.error("Failed to reject invitation", result.error);
        toast.error(t("rejectError"));
        return;
      }

      toast.success(t("rejectSuccess"));
      router.refresh();
    } catch (error) {
      console.error("Error rejecting invitation:", error);
      toast.error(t("rejectError"));
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleReject}
        disabled={loading}
      >
        {loading && action === "reject" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <X className="h-4 w-4" />
        )}
        {t("reject")}
      </Button>
      <Button size="sm" onClick={handleAccept} disabled={loading}>
        {loading && action === "accept" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        {t("accept")}
      </Button>
    </div>
  );
}
