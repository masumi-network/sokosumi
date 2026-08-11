"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { acceptRoomGuestInviteLinkAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Button } from "@/components/ui/button";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

interface ChatJoinActionsProps {
  token: string;
  roomName: string;
  isAuthenticated: boolean;
}

export function ChatJoinActions({
  token,
  roomName,
  isAuthenticated,
}: ChatJoinActionsProps) {
  const t = useTranslations("App.Channels.ChatJoin");
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    if (isJoining) return;
    setIsJoining(true);
    try {
      const result = await acceptRoomGuestInviteLinkAction(token);
      if (!result.ok) {
        toast.error(result.error.message ?? t("Error.joinFailed"));
        // Re-enable only on failure so the user can retry.
        setIsJoining(false);
        return;
      }
      toast.success(
        result.value.status === "already_guest"
          ? t("alreadyGuest", { room: roomName })
          : t("joined", { room: roomName }),
      );
      notifyOrganizationChatRoomsChanged();
      // Keep loading until navigation unmounts this page — clearing here
      // flashes an idle CTA between accept and redirect.
      router.push(`/chat/rooms/${encodeURIComponent(result.value.roomId)}`);
      router.refresh();
    } catch (error) {
      console.error("Failed to join channel via invite link", error);
      toast.error(t("Error.joinFailed"));
      setIsJoining(false);
    }
  };

  const goToAuth = (path: "/signin" | "/signup") => {
    const returnUrl = getReturnUrlFromCurrentLocation();
    router.push(`${path}?returnUrl=${encodeURIComponent(returnUrl)}`);
  };

  if (isAuthenticated) {
    return (
      <Button
        variant="primary"
        className="w-full"
        onClick={handleJoin}
        disabled={isJoining}
      >
        {isJoining && <Loader2 className="size-4 animate-spin" />}
        {isJoining ? t("joining") : t("join", { room: roomName })}
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-center text-sm">
        {t("signedOutHint")}
      </p>
      <Button
        variant="primary"
        className="w-full"
        onClick={() => goToAuth("/signin")}
      >
        {t("signIn")}
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => goToAuth("/signup")}
      >
        {t("register")}
      </Button>
    </div>
  );
}
