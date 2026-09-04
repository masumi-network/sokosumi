"use client";

import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ChatComposeOrchestrator } from "@/app/chat/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChatRoomPresence,
  Coworker,
  Member,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

export function AiCoworkerIcon({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const t = useTranslations("App.Channels");

  return (
    <Bot
      className={cn("text-muted-foreground size-3.5 shrink-0", className)}
      aria-label={label ?? t("coworkerBadge")}
    />
  );
}

interface AiCoworkerAvatarBadgeProps {
  className?: string;
}

/** Discord-style bot chip for avatar corner (sibling of Avatar, not inside it). */
export function AiCoworkerAvatarBadge({
  className,
}: AiCoworkerAvatarBadgeProps) {
  const t = useTranslations("App.Channels");

  return (
    <span
      role="img"
      aria-label={t("coworkerBadge")}
      data-testid="coworker-avatar-badge"
      className={cn(
        // bg-muted + foreground icon so chip reads on dark chat (bg-background was invisible)
        "bg-muted text-foreground absolute -right-0.5 -bottom-0.5 z-10 flex size-3.5 items-center justify-center rounded-full ring-2 ring-background",
        className,
      )}
    >
      {/* Decorative — label lives on the chip so we avoid nested named graphics */}
      <Bot className="size-2.5 shrink-0" aria-hidden />
    </span>
  );
}

/** Parity with rooms-client messageLoadFailed empty-state; reload re-fetches RSC props. */
export function MembersRosterLoadFailed({
  className,
  onRetry,
  title,
  description,
}: {
  className?: string;
  onRetry?: () => void;
  title?: string;
  description?: string;
}) {
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
      <p className="font-medium">
        {title ?? t("Empty.membersLoadFailedTitle")}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        {description ?? t("Empty.membersLoadFailedDescription")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => {
          if (onRetry) {
            onRetry();
            return;
          }
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
  kind: "human" | "coworker" | "orchestrator";
  slug?: string;
  caption?: string | null;
  avatarSeed?: string | null;
  presence?: ChatRoomPresence;
}

export function buildDirectDraftTargets(
  members: Member[],
  coworkers: Coworker[],
  orchestrators: ChatComposeOrchestrator[],
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
    ...orchestrators.map((orchestrator) => ({
      key: `orchestrator:${orchestrator.id}`,
      id: orchestrator.id,
      name: orchestrator.name,
      detail: "",
      image: orchestrator.image,
      kind: "orchestrator" as const,
      avatarSeed: orchestrator.avatarSeed,
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
  disabled = false,
  disabledReason,
}: {
  target: DirectDraftTarget;
  onSelect: (target: DirectDraftTarget) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const t = useTranslations("App.Channels");
  const row = (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
        disabled
          ? "text-muted-foreground cursor-not-allowed opacity-50"
          : "hover:bg-muted/70",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        if (disabled) {
          return;
        }
        onSelect(target);
      }}
    >
      <Avatar className="size-7 shrink-0">
        <AvatarImage src={target.image ?? undefined} alt="" />
        <AvatarFallback className="text-[0.625rem]">
          {getInitials(target.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{target.name}</span>
          {target.kind === "coworker" || target.kind === "orchestrator" ? (
            <AiCoworkerIcon
              label={
                target.kind === "orchestrator"
                  ? t("personalAssistantBadge")
                  : undefined
              }
            />
          ) : null}
        </span>
        {target.detail ? (
          <span className="text-muted-foreground block truncate text-xs">
            {target.detail}
          </span>
        ) : null}
      </span>
    </button>
  );

  if (!disabled || !disabledReason) {
    return row;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block w-full">{row}</span>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {disabledReason}
      </TooltipContent>
    </Tooltip>
  );
}

export function DirectDraftTargetList({
  targets,
  onSelect,
  isTargetDisabled,
  disabledReason,
}: {
  targets: readonly DirectDraftTarget[];
  onSelect: (target: DirectDraftTarget) => void;
  isTargetDisabled?: (target: DirectDraftTarget) => boolean;
  disabledReason?: string;
}) {
  const t = useTranslations("App.Channels");
  const humans = targets.filter((target) => target.kind === "human");
  const coworkerTargets = targets.filter(
    (target) => target.kind === "coworker",
  );
  const orchestratorTargets = targets.filter(
    (target) => target.kind === "orchestrator",
  );
  const sectionCount = [
    humans.length > 0,
    coworkerTargets.length > 0,
    orchestratorTargets.length > 0,
  ].filter(Boolean).length;
  const showSectionLabels = sectionCount > 1;

  return (
    <>
      {humans.length > 0 ? (
        <div
          className={
            coworkerTargets.length > 0 || orchestratorTargets.length > 0
              ? "pb-1"
              : undefined
          }
        >
          {showSectionLabels ? (
            <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium">
              {t("Dialog.humans")}
            </div>
          ) : null}
          {humans.map((target) => {
            const disabled = isTargetDisabled?.(target) ?? false;
            return (
              <DirectDraftTargetRow
                key={target.key}
                target={target}
                onSelect={onSelect}
                disabled={disabled}
                disabledReason={disabled ? disabledReason : undefined}
              />
            );
          })}
        </div>
      ) : null}
      {coworkerTargets.length > 0 ? (
        <div className={orchestratorTargets.length > 0 ? "pb-1" : undefined}>
          {showSectionLabels ? (
            <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium">
              {t("Dialog.coworkers")}
            </div>
          ) : null}
          {coworkerTargets.map((target) => {
            const disabled = isTargetDisabled?.(target) ?? false;
            return (
              <DirectDraftTargetRow
                key={target.key}
                target={target}
                onSelect={onSelect}
                disabled={disabled}
                disabledReason={disabled ? disabledReason : undefined}
              />
            );
          })}
        </div>
      ) : null}
      {orchestratorTargets.length > 0 ? (
        <div>
          {showSectionLabels ? (
            <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium">
              {t("Dialog.personalAssistants")}
            </div>
          ) : null}
          {orchestratorTargets.map((target) => {
            const disabled = isTargetDisabled?.(target) ?? false;
            return (
              <DirectDraftTargetRow
                key={target.key}
                target={target}
                onSelect={onSelect}
                disabled={disabled}
                disabledReason={disabled ? disabledReason : undefined}
              />
            );
          })}
        </div>
      ) : null}
    </>
  );
}
