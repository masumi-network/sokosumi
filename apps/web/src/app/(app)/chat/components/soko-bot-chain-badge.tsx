"use client";

import { Repeat2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SokoBotChainInfo {
  depth: number;
  maxDepth: number;
  roomMessagesThisHour: number;
  roomMessagesPerHour: number;
}

function readChainMetadata(metadata: unknown): SokoBotChainInfo | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { soko_bot_chain?: unknown }).soko_bot_chain;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const num = (key: string) =>
    typeof record[key] === "number" ? (record[key] as number) : null;
  const depth = num("depth");
  const maxDepth = num("max_depth");
  const roomMessagesThisHour = num("room_messages_this_hour");
  const roomMessagesPerHour = num("room_messages_per_hour");
  if (
    depth === null ||
    maxDepth === null ||
    roomMessagesThisHour === null ||
    roomMessagesPerHour === null
  ) {
    return null;
  }
  return { depth, maxDepth, roomMessagesThisHour, roomMessagesPerHour };
}

/**
 * Shown on hover beside a message an assistant wrote to another assistant.
 * Two bots talking is the one exchange with nobody in it to notice it running
 * long, so the reader can see how far it has gone and how close both limits
 * are without opening anything.
 */
export function SokoBotChainBadge({ metadata }: { metadata: unknown }) {
  const t = useTranslations("App.Chat.SokoBot");
  const info = readChainMetadata(metadata);
  if (!info) return null;
  const lastHop = info.depth >= info.maxDepth;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="soko-bot-chain-badge"
          className="text-muted-foreground border-border inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
        >
          <Repeat2 aria-hidden className="size-3" />
          <span className="tabular-nums">
            {info.depth}/{info.maxDepth}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <p>{t("chainDepth", { depth: info.depth, max: info.maxDepth })}</p>
        <p className="text-muted-foreground mt-1">
          {t("chainRoomRate", {
            count: info.roomMessagesThisHour,
            max: info.roomMessagesPerHour,
          })}
        </p>
        {lastHop ? (
          <p className="text-muted-foreground mt-1">{t("chainLastHop")}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
