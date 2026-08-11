"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface StripCoworker {
  id: string;
  imageUrl: null | string;
  name: string;
  /** The coworker's speciality, shown in the tooltip. Null when unset. */
  title: null | string;
}

interface CoworkerStripProps {
  featured: StripCoworker;
  /** Rendered around the featured coworker, split evenly left and right. */
  others: StripCoworker[];
}

/**
 * The featured coworker flanked by the rest of the team.
 *
 * Every face opens that coworker's direct room, so the strip doubles as a
 * picker — the point being that Elena is a starting suggestion, not the only
 * coworker available.
 */
export function CoworkerStrip({ featured, others }: CoworkerStripProps) {
  const t = useTranslations("App.Chat.Landing");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openingId, setOpeningId] = useState<null | string>(null);

  // Callers pass an even list, so the flanks match and the featured face lands
  // on the optical centre.
  const half = Math.floor(others.length / 2);
  const left = others.slice(0, half);
  const right = others.slice(half);

  function handleOpen(coworker: StripCoworker) {
    if (isPending) return;
    setOpeningId(coworker.id);
    startTransition(async () => {
      const result = await ensureCoworkerDirectRoomAction(coworker.id);

      if (!result.ok || !result.value) {
        toast.error(result.ok ? t("cta.error") : result.error.message);
        setOpeningId(null);
        return;
      }

      notifyOrganizationChatRoomsChanged(result.value);
      router.push(`/chat/rooms/${result.value.id}`);
    });
  }

  function renderCoworker(coworker: StripCoworker, isFeatured: boolean) {
    return (
      <Tooltip key={coworker.id}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("cta.button", { name: coworker.name })}
            className={cn(
              "focus-visible:ring-ring bg-muted relative shrink-0 cursor-pointer overflow-hidden rounded-full transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              isFeatured
                ? "ring-border size-28 ring-1"
                : "size-16 opacity-70 hover:opacity-100",
              openingId === coworker.id && "opacity-50",
            )}
            disabled={isPending}
            onClick={() => handleOpen(coworker)}
          >
            {coworker.imageUrl ? (
              <Image
                alt={t("team.avatarAlt", { name: coworker.name })}
                className="object-cover object-top"
                fill
                priority={isFeatured}
                sizes={isFeatured ? "112px" : "64px"}
                src={coworker.imageUrl}
              />
            ) : (
              <span
                className={cn(
                  "text-muted-foreground flex size-full items-center justify-center font-medium",
                  isFeatured ? "text-2xl" : "text-sm",
                )}
              >
                {coworker.name.charAt(0).toUpperCase()}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="font-medium">{coworker.name}</span>
          {/* The featured coworker's title is already spelled out under the
              strip, so repeating it here would only contradict it. */}
          {!isFeatured && coworker.title ? (
            <span className="block opacity-80">{coworker.title}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex w-full items-center justify-center gap-5 sm:gap-8">
      {left.map((coworker) => renderCoworker(coworker, false))}
      {renderCoworker(featured, true)}
      {right.map((coworker) => renderCoworker(coworker, false))}
    </div>
  );
}
