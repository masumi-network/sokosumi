"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useCanUseOrganizationWorkstation } from "@/contexts/organization-workstation-context";
import { cn } from "@/lib/utils";

import { useOpenCoworkerRoom } from "./use-open-coworker-room";

interface StartChatButtonProps {
  /** Mobile passes `w-full` so the CTA spans the column. */
  className?: string;
  coworkerId: string;
  coworkerName: string;
  /**
   * Landing uses filled primary; gallery uses outline next to Start New Task.
   * Primary keeps the larger landing face (`h-12`); outline matches adjacent CTAs.
   */
  variant?: "primary" | "outline";
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
  variant = "primary",
}: StartChatButtonProps) {
  const t = useTranslations("App.Chat.Landing");
  const tWorkstation = useTranslations("App.Channels");
  const canUseWorkstation = useCanUseOrganizationWorkstation();
  const { isPending, openCoworkerRoom, openingId } = useOpenCoworkerRoom();
  const isBusy = isPending || openingId === coworkerId;

  if (!canUseWorkstation) {
    return (
      <p className="text-muted-foreground text-sm">
        {tWorkstation("Workstation.coworkerDirectDisabled")}
      </p>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      className={cn(variant === "primary" && "h-12 px-8 text-base", className)}
      disabled={isBusy}
      onClick={() => openCoworkerRoom(coworkerId)}
    >
      {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
      {isBusy ? t("cta.opening") : t("cta.button", { name: coworkerName })}
    </Button>
  );
}
