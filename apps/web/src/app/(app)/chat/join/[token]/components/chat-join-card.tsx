"use client";

import type { SessionUser } from "@sokosumi/utils";
import { AlertCircle, Hash } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ChatJoinActions } from "./chat-join-actions";

interface ChatJoinRoomPreview {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
}

interface ChatJoinCardProps {
  token: string;
  room: ChatJoinRoomPreview;
  user?: SessionUser;
}

export function ChatJoinCard({ token, room, user }: ChatJoinCardProps) {
  const t = useTranslations("App.Channels.ChatJoin");

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-muted mb-2 flex size-16 items-center justify-center overflow-hidden rounded-2xl">
            <Hash className="text-muted-foreground size-7" />
          </div>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t("invitedToJoin", {
              room: room.name,
              organization: room.organizationName,
            })}
          </p>
          <p className="text-muted-foreground text-xs">{t("guestNote")}</p>
        </CardHeader>
        <CardContent>
          <ChatJoinActions
            token={token}
            roomName={room.name}
            isAuthenticated={Boolean(user)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function ChatJoinInvalidCard({
  status,
}: {
  status: "valid" | "expired" | "revoked" | "depleted" | "not_found";
}) {
  const t = useTranslations("App.Channels.ChatJoin");

  const messageKey =
    status === "expired"
      ? "Invalid.expired"
      : status === "revoked"
        ? "Invalid.revoked"
        : status === "depleted"
          ? "Invalid.depleted"
          : "Invalid.notFound";

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="text-destructive size-6" />
            <CardTitle className="text-destructive text-xl">
              {t("Invalid.title")}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{t(messageKey)}</p>
          <Button variant="outline" asChild className="w-full">
            <Link href="/">{t("Invalid.back")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
