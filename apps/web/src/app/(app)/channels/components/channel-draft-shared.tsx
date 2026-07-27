"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type {
  ChatRoomPresence,
  Coworker,
  Member,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

export function AiCoworkerIcon({ className }: { className?: string }) {
  const t = useTranslations("App.Channels");

  return (
    <Bot
      className={cn("text-muted-foreground size-3.5 shrink-0", className)}
      aria-label={t("coworkerBadge")}
    />
  );
}

export interface DirectDraftTarget {
  key: string;
  id: string;
  name: string;
  detail: string;
  image: string | null;
  kind: "human" | "coworker";
  slug?: string;
  caption?: string | null;
  presence?: ChatRoomPresence;
}

export function buildDirectDraftTargets(
  members: Member[],
  coworkers: Coworker[],
  currentUserId: string,
): DirectDraftTarget[] {
  return [
    ...coworkers.map((coworker) => ({
      key: `coworker:${coworker.id}`,
      id: coworker.id,
      name: coworker.name,
      detail: coworker.caption ?? (coworker.slug ? `@${coworker.slug}` : ""),
      image: coworker.image ?? null,
      kind: "coworker" as const,
      slug: coworker.slug,
      caption: coworker.caption,
      presence: "online" as const,
    })),
    ...members
      .filter((member) => member.user.id !== currentUserId)
      .map((member) => ({
        key: `human:${member.user.id}`,
        id: member.user.id,
        name: member.user.name || member.user.email,
        detail: member.user.email,
        image: member.user.image ?? null,
        kind: "human" as const,
      })),
  ];
}

export function DirectDraftTargetRow({
  target,
  onSelect,
}: {
  target: DirectDraftTarget;
  onSelect: (target: DirectDraftTarget) => void;
}) {
  return (
    <button
      type="button"
      className="hover:bg-muted/70 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(target);
      }}
    >
      <Avatar className="size-7 shrink-0">
        <AvatarImage src={target.image ?? undefined} alt="" />
        <AvatarFallback className="text-[10px]">
          {getInitials(target.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{target.name}</span>
          {target.kind === "coworker" ? <AiCoworkerIcon /> : null}
        </span>
        {target.detail ? (
          <span className="text-muted-foreground block truncate text-xs">
            {target.detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
