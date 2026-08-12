"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useOpenCoworkerRoom } from "./use-open-coworker-room";

interface StartChatButtonProps {
  /** Mobile passes `w-full` so the CTA spans the column. */
  className?: string;
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
  className,
  coworkerId,
  coworkerName,
}: StartChatButtonProps) {
  const t = useTranslations("App.Chat.Landing");
  const { isPending, openCoworkerRoom, openingId } = useOpenCoworkerRoom();
  const isBusy = isPending || openingId === coworkerId;

  return (
    <Button
      type="button"
      variant="primary"
      size="lg"
      className={cn("h-12 px-8 text-base", className)}
      disabled={isBusy}
      onClick={() => openCoworkerRoom(coworkerId)}
    >
      {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
      {isBusy ? t("cta.opening") : t("cta.button", { name: coworkerName })}
    </Button>
  );
}
