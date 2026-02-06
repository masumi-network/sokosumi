import { MessageSquare, UserCog } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ipfsUrlResolver } from "@/lib/ipfs";
import { type TaskWithCoworker } from "@/lib/types/task";
import { formatShortDate } from "@/lib/utils/datetime";

const COWORKER_FALLBACK_IMAGES: Record<string, string> = {
  soko: "/images/kanji/sokosumi-logo-kanji-black.svg",
  sumi: "/images/kanji/sokosumi-logo-kanji-black.svg",
  hannah: "/images/coworkers/hannah.png",
};

interface TaskMetaDetailsProps {
  coworker: TaskWithCoworker["coworker"];
  commentsCount: TaskWithCoworker["commentsCount"];
  createdAt: TaskWithCoworker["createdAt"];
  variant?: "card" | "list";
}

function getCoworkerImage(coworker: TaskWithCoworker["coworker"]): string | null {
  if (coworker?.image) {
    return ipfsUrlResolver(coworker.image);
  }
  const slug = coworker?.slug?.toLowerCase() ?? coworker?.name?.toLowerCase();
  if (slug && COWORKER_FALLBACK_IMAGES[slug]) {
    return COWORKER_FALLBACK_IMAGES[slug];
  }
  return null;
}

function CoworkerAvatar({
  coworker,
  size = "sm",
}: {
  coworker: TaskWithCoworker["coworker"];
  size?: "sm" | "md";
}) {
  const image = getCoworkerImage(coworker);
  const sizeClass = size === "sm" ? "size-5" : "size-6";

  return (
    <Avatar className={`${sizeClass} shrink-0 ring-2 ring-background`}>
      {image ? (
        <AvatarImage
          src={image}
          alt={coworker?.name ?? "Coworker"}
          className="object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <AvatarFallback className="bg-muted text-[10px] font-medium">
        {coworker?.name?.slice(0, 1).toUpperCase() ?? <UserCog className="size-3" aria-hidden />}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskMetaDetails({
  coworker,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  if (variant === "list") {
    return (
      <>
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate text-xs">
          <CoworkerAvatar coworker={coworker} />
          <span className="truncate">{coworker?.name ?? "—"}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <MessageSquare className="size-3.5" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="text-muted-foreground text-xs">
          <span className="whitespace-nowrap">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
      <div className="flex items-center gap-1.5">
        <CoworkerAvatar coworker={coworker} />
        <span className="text-muted-foreground text-xs truncate max-w-[80px]">
          {coworker?.name ?? "—"}
        </span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground/60">
        {commentsCount > 0 && (
          <div className="flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden />
            <span className="text-[10px] tabular-nums">{commentsCount}</span>
          </div>
        )}
        <span className="text-[10px] tabular-nums">
          {formatShortDate(createdAt)}
        </span>
      </div>
    </div>
  );
}
