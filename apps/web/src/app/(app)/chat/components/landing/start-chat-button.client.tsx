"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Button } from "@/components/ui/button";

interface StartChatButtonProps {
  coworkerId: string;
  coworkerName: string;
}

/**
 * Opens (or reuses) the 1:1 room with a coworker.
 *
 * Has to be a client button rather than a link: the room is created by a
 * server action and there is no URL that addresses a specific coworker's DM.
 */
export function StartChatButton({
  coworkerId,
  coworkerName,
}: StartChatButtonProps) {
  const t = useTranslations("App.Chat.Landing");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpening, setIsOpening] = useState(false);

  const isBusy = isPending || isOpening;

  function handleClick() {
    setIsOpening(true);
    startTransition(async () => {
      const result = await ensureCoworkerDirectRoomAction(coworkerId);

      if (!result.ok || !result.value) {
        toast.error(result.ok ? t("cta.error") : result.error.message);
        setIsOpening(false);
        return;
      }

      // Same order the rest of chat uses: tell the sidebar before navigating so
      // the new room is already in the list when the route renders.
      notifyOrganizationChatRoomsChanged(result.value);
      router.push(`/chat/rooms/${result.value.id}`);
      // Deliberately leave the spinner running — the route change unmounts
      // this button, and resetting here would flash the idle label.
    });
  }

  return (
    <Button
      type="button"
      variant="primary"
      size="lg"
      className="h-12 px-8 text-base"
      disabled={isBusy}
      onClick={handleClick}
    >
      {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
      {isBusy ? t("cta.opening") : t("cta.button", { name: coworkerName })}
    </Button>
  );
}
