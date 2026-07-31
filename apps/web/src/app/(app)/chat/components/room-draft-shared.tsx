"use client";

import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

/** Parity with rooms-client messageLoadFailed empty-state; reload re-fetches RSC props. */
export function MembersRosterLoadFailed({ className }: { className?: string }) {
  const t = useTranslations("App.Channels");
  const router = useRouter();

  return (
    <div
      className={cn(
        "border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center",
        className,
      )}
      role="status"
    >
      <p className="font-medium">{t("Empty.membersLoadFailedTitle")}</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("Empty.membersLoadFailedDescription")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => {
          router.refresh();
        }}
      >
        {t("Empty.membersLoadFailedRetry")}
      </Button>
    </div>
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
  // Humans first so org members stay reachable when many AI coworkers exist;
  // pickers scroll rather than hard-capping the list.
  return [
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
  ];
}

export function filterDraftTargets(
  targets: readonly DirectDraftTarget[],
  selectedKeys: ReadonlySet<string>,
  query: string,
): DirectDraftTarget[] {
  const normalizedQuery = query.trim().toLowerCase();
  return targets
    .filter((target) => !selectedKeys.has(target.key))
    .filter((target) => {
      if (!normalizedQuery) {
        return true;
      }
      return [target.name, target.detail, target.slug ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
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

export function DirectDraftTargetList({
  targets,
  onSelect,
}: {
  targets: readonly DirectDraftTarget[];
  onSelect: (target: DirectDraftTarget) => void;
}) {
  const t = useTranslations("App.Channels");
  const humans = targets.filter((target) => target.kind === "human");
  const coworkerTargets = targets.filter(
    (target) => target.kind === "coworker",
  );
  const showSectionLabels = humans.length > 0 && coworkerTargets.length > 0;

  return (
    <>
      {humans.length > 0 ? (
        <div className={coworkerTargets.length > 0 ? "pb-1" : undefined}>
          {showSectionLabels ? (
            <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">
              {t("Dialog.humans")}
            </div>
          ) : null}
          {humans.map((target) => (
            <DirectDraftTargetRow
              key={target.key}
              target={target}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
      {coworkerTargets.length > 0 ? (
        <div>
          {showSectionLabels ? (
            <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">
              {t("Dialog.coworkers")}
            </div>
          ) : null}
          {coworkerTargets.map((target) => (
            <DirectDraftTargetRow
              key={target.key}
              target={target}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
