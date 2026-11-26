"use client";

import { Archive, MoreHorizontal, Pause, Play, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ArchiveSokoBotDialog } from "@/app/personal-assistant/components/archive-soko-bot-button.client";
import { usePauseSokoBot } from "@/app/soko-bots/components/pause-soko-bot-button.client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface BotManageMenuProps {
  name: string;
  settingsHref: string;
  /** `null` for the viewer's own bot. */
  botId: string | null;
  /** `null` when the bot can't be paused here. */
  paused: boolean | null;
  canArchive: boolean;
}

/** The card's "…": Settings, Pause or Resume, and Archive where allowed. */
export function BotManageMenu({
  name,
  settingsHref,
  botId,
  paused,
  canArchive,
}: BotManageMenuProps) {
  const t = useTranslations("App.SokoBots");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const { toggle, pending } = usePauseSokoBot({
    botId,
    name,
    paused: paused ?? false,
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={pending}>
          <Button
            type="button"
            size="sm"
            loading={pending}
            aria-label={t("moreName", { name })}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={settingsHref}>
              <Settings aria-hidden />
              {t("settings")}
            </Link>
          </DropdownMenuItem>
          {paused === null ? null : (
            <DropdownMenuItem onSelect={toggle}>
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {t(paused ? "resume" : "pause")}
            </DropdownMenuItem>
          )}
          {canArchive ? (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
              <Archive aria-hidden />
              {t("Archive.archive")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canArchive ? (
        <ArchiveSokoBotDialog
          botId={botId}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        />
      ) : null}
    </>
  );
}
