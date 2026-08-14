"use client";

import { AlertCircle, CheckIcon, Loader2, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  acceptChatRoomInvitationAction,
  declineChatRoomInvitationAction,
} from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChatRoomInvitation } from "@/lib/clients/generated/core";

interface ChatRoomInvitationCardProps {
  invitation: ChatRoomInvitation;
}

export default function ChatRoomInvitationCard({
  invitation,
}: ChatRoomInvitationCardProps) {
  const t = useTranslations("App.Channels.ChatInvite");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "decline" | null>(null);

  const handleAccept = async () => {
    if (loading) return;
    setLoading(true);
    setAction("accept");
    const result = await acceptChatRoomInvitationAction(invitation.id);
    if (!result.ok) {
      toast.error(result.error.message || t("Actions.Error.accept"));
      setLoading(false);
      setAction(null);
      return;
    }
    toast.success(t("Actions.Success.accept"));
    notifyOrganizationChatRoomsChanged();
    router.push(`/chat/rooms/${encodeURIComponent(result.value.roomId)}`);
    router.refresh();
  };

  const handleDecline = async () => {
    if (loading) return;
    setLoading(true);
    setAction("decline");
    const result = await declineChatRoomInvitationAction(invitation.id);
    if (!result.ok) {
      toast.error(result.error.message || t("Actions.Error.decline"));
      setLoading(false);
      setAction(null);
      return;
    }
    toast.success(t("Actions.Success.decline"));
    notifyOrganizationChatRoomsChanged();
    router.push("/");
    router.refresh();
  };

  if (invitation.status === "accepted") {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
            <CheckIcon className="size-8 text-green-600" />
          </div>
          <h1 className="text-center text-2xl font-light">
            {t("acceptedTitle", { roomName: invitation.roomName })}
          </h1>
          <p className="text-center text-sm">
            {t("acceptedDescription", {
              organizationName: invitation.organizationName,
            })}
          </p>
        </CardContent>
        <CardFooter>
          <Button variant="outline" asChild className="w-full">
            <Link href={`/chat/rooms/${encodeURIComponent(invitation.roomId)}`}>
              {t("goToRoom")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (
    invitation.status === "declined" ||
    invitation.status === "revoked" ||
    invitation.status === "expired"
  ) {
    const titleKey =
      invitation.status === "expired"
        ? "expiredTitle"
        : invitation.status === "revoked"
          ? "revokedTitle"
          : "declinedTitle";
    const descriptionKey =
      invitation.status === "expired"
        ? "expiredDescription"
        : invitation.status === "revoked"
          ? "revokedDescription"
          : "declinedDescription";

    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
            <XIcon className="size-8 text-red-600" />
          </div>
          <h1 className="text-center text-2xl font-light">{t(titleKey)}</h1>
          <p className="text-muted-foreground text-center text-sm">
            {t(descriptionKey, {
              roomName: invitation.roomName,
              organizationName: invitation.organizationName,
            })}
          </p>
        </CardContent>
        <CardFooter>
          <Button variant="outline" asChild className="w-full">
            <Link href="/">{t("goToChat")}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // pending
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <p>
            <strong>{invitation.inviter.name}</strong>{" "}
            {t("hasInvitedYouToJoin")} <strong>#{invitation.roomName}</strong>
          </p>
          <p className="text-muted-foreground">
            {t("organizationLabel", {
              organizationName: invitation.organizationName,
            })}
          </p>
          <p className="text-muted-foreground text-xs">{t("guestNote")}</p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between gap-2 sm:gap-4">
        <Button
          variant="outline"
          onClick={() => void handleDecline()}
          disabled={loading}
        >
          {loading && action === "decline" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("Actions.decline")}
        </Button>
        <Button onClick={() => void handleAccept()} disabled={loading}>
          {loading && action === "accept" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("Actions.accept")}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function ChatRoomInvitationErrorCard({
  errorCode,
}: {
  errorCode: "NOT_FOUND" | "EXPIRED";
}) {
  const t = useTranslations(
    errorCode === "EXPIRED"
      ? "App.Channels.ChatInvite.Error.Expired"
      : "App.Channels.ChatInvite.Error.NotFound",
  );

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <AlertCircle className="text-destructive size-6" />
          <CardTitle className="text-destructive text-xl">
            {t("title")}
          </CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm">{t("content")}</p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" asChild className="w-full">
          <Link href="/">{t("footer")}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
