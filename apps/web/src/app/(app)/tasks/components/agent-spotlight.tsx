"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  OfferDetailDialog,
  type OfferDetailItem,
  type OutputKind,
} from "@/components/agents/offer-card";
import { TagIcon } from "@/components/agents/tag-icon";
import { VendorMark } from "@/components/agents/vendor-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoworkerOffer, CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { regionFlag } from "@/lib/utils/region-flag";

import { OfferPicker } from "./offer-picker";

export interface AgentSpotlightLabels {
  defaultBadge: string;
  modelLabel: string;
  hostingLabel: string;
  tasksTitle: string;
  startFromScratch: string;
  startFromScratchHint: string;
  previewExample: string;
  previewUse: string;
  previewEmpty: string;
  noResults: string;
}

interface AgentSpotlightProps {
  options: CoworkerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Pre-fills the editor with the offer's prompt and advances. */
  onPickOffer: (offer: CoworkerOffer) => void;
  /** Opens a blank editor. */
  onStartFromScratch: () => void;
  defaultSlug?: string;
  labels: AgentSpotlightLabels;
}

const FOCUS_RING =
  "focus-visible:ring-primary/30 outline-none focus-visible:ring-2";
const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent [scrollbar-width:thin]";

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

/** Model + hosting chips shown both in the spotlight header and the task preview. */
function MetaTagChips({
  llm,
  hosting,
  modelLabel,
  hostingLabel,
}: {
  llm: string[];
  hosting?: string;
  modelLabel: string;
  hostingLabel: string;
}) {
  if (llm.length === 0 && !hosting) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {llm.map((model) => (
        <span
          key={model}
          title={`${modelLabel}: ${model}`}
          className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
        >
          <TagIcon name={model} size={12} />
          {model}
        </span>
      ))}
      {hosting ? (
        <span
          title={`${hostingLabel}: ${hosting}`}
          className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
        >
          <span aria-hidden>{regionFlag(hosting)}</span>
          {hosting}
        </span>
      ) : null}
    </div>
  );
}

function RailItem({
  option,
  active,
  onSelect,
  className,
}: {
  option: CoworkerOption;
  active: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
        FOCUS_RING,
        active ? "bg-muted" : "hover:bg-muted/50",
        className,
      )}
    >
      <Avatar className="ring-border size-8 shrink-0 rounded-full ring-1">
        <AvatarImage src={option.image} alt="" className="object-cover" />
        <AvatarFallback className="rounded-full text-xs font-medium">
          {initials(option.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-foreground truncate text-sm font-medium">
          {option.name}
        </p>
        {option.caption ? (
          <p className="text-muted-foreground truncate text-xs">
            {option.caption}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function RailItemSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-2",
        className,
      )}
    >
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

function OfferCardSkeleton() {
  return (
    <div className="bg-card border-border/60 flex flex-col overflow-hidden rounded-2xl border">
      <Skeleton className="aspect-[16/10] w-full rounded-none border-b" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
        <div className="mt-auto flex items-center pt-1">
          <Skeleton className="ml-auto size-4 rounded-sm" />
        </div>
      </div>
    </div>
  );
}

/** The spotlight's silhouette while its coworker options are still loading:
 *  same rails, header, chips, and task-card grid, so nothing shifts once the
 *  real thing mounts. Keep it in step with `AgentSpotlight` below. */
export function AgentSpotlightSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {/* Rail (mobile) */}
      <div className="flex shrink-0 gap-2 overflow-hidden border-b pb-3 md:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <RailItemSkeleton key={index} className="w-44 shrink-0" />
        ))}
      </div>

      {/* Rail (desktop) */}
      <div className="hidden md:flex md:w-52 md:shrink-0 md:flex-col md:gap-4 md:py-1 md:pr-3">
        {[3, 2].map((count, group) => (
          <div key={group} className="space-y-1">
            <Skeleton className="mx-2 my-1 h-3 w-16" />
            {Array.from({ length: count }, (_, index) => (
              <RailItemSkeleton key={index} className="w-full" />
            ))}
          </div>
        ))}
      </div>

      {/* Detail */}
      <div className="border-border min-w-0 flex-1 space-y-5 overflow-hidden pt-4 md:border-l md:pt-1 md:pl-6">
        <div className="flex items-start gap-4">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="mt-1.5 h-4 w-24" />
          </div>
        </div>

        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Skeleton className="h-6 w-24 rounded-md" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>

        <div className="space-y-3">
          <Skeleton className="h-3 w-44" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <OfferCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Combined first step: a spotlight master-detail — pick a coworker (left rail on
 *  desktop, horizontal strip on mobile), see their details + large ready-to-run
 *  task cards on the right. Picking a task advances to the editor; a preview
 *  button shows the task's example output. */
export function AgentSpotlight({
  options,
  selectedId,
  onSelect,
  onPickOffer,
  onStartFromScratch,
  defaultSlug = "elena",
  labels,
}: AgentSpotlightProps) {
  const t = useTranslations("App.Agents.CoworkerGallerySection");
  const getTypeLabel = (type: OutputKind) => t(`outputTypes.${type}`);
  const [previewOffer, setPreviewOffer] = useState<CoworkerOffer | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, CoworkerOption[]>();
    for (const option of options) {
      const key = option.vendor.id;
      const list = map.get(key);
      if (list) list.push(option);
      else map.set(key, [option]);
    }
    return Array.from(map.entries())
      .map(([vendorId, members]) => ({
        vendor: members[0]?.vendor,
        vendorId,
        members,
        topPriority: Math.max(...members.map((m) => m.priority ?? 0)),
      }))
      .sort(
        (a, b) =>
          b.topPriority - a.topPriority ||
          a.vendor.name.localeCompare(b.vendor.name),
      );
  }, [options]);

  const current =
    options.find((option) => option.id === selectedId) ?? options[0];
  const llm = current?.profile?.llm ?? [];
  const hosting = current?.profile?.hosting;

  if (!current) {
    return (
      <p className="text-muted-foreground flex-1 py-8 text-center text-sm">
        {labels.noResults}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {/* Rail (mobile) — horizontal strip of coworkers */}
      <div
        className={cn(
          "flex shrink-0 gap-2 overflow-x-auto border-b pb-3 md:hidden",
          SCROLLBAR,
        )}
      >
        {options.map((option) => (
          <RailItem
            key={option.id}
            option={option}
            active={option.id === current.id}
            onSelect={() => onSelect(option.id)}
            className="w-44 shrink-0"
          />
        ))}
      </div>

      {/* Rail (desktop) — coworker selector grouped by company */}
      <div
        className={cn(
          "hidden md:flex md:w-52 md:shrink-0 md:flex-col md:gap-4 md:overflow-y-auto md:py-1 md:pr-3",
          SCROLLBAR,
        )}
      >
        {groups.map((group) => (
          <div key={group.vendorId} className="space-y-1">
            <p className="text-muted-foreground px-2 text-xs font-medium">
              {group.vendor.name}
            </p>
            {group.members.map((member) => (
              <RailItem
                key={member.id}
                option={member}
                active={member.id === current.id}
                onSelect={() => onSelect(member.id)}
                className="w-full"
              />
            ))}
          </div>
        ))}
      </div>

      {/* Detail — spotlight + ready-to-run tasks */}
      <div
        key={current.id}
        className={cn(
          "border-border animate-in fade-in-0 min-w-0 flex-1 space-y-5 overflow-y-auto pt-4 md:border-l md:pt-1 md:pl-6",
          SCROLLBAR,
        )}
      >
        <div className="flex items-start gap-4">
          <Avatar className="ring-border size-16 shrink-0 rounded-full ring-1">
            <AvatarImage src={current.image} alt="" className="object-cover" />
            <AvatarFallback className="rounded-full text-lg font-medium">
              {initials(current.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-foreground text-lg font-medium">
                {current.name}
              </h3>
              {current.slug === defaultSlug ? (
                <span className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-xs leading-none font-medium">
                  {labels.defaultBadge}
                </span>
              ) : null}
            </div>
            {current.caption ? (
              <p className="text-muted-foreground text-sm">{current.caption}</p>
            ) : null}
            <div className="mt-1.5 flex h-5 items-center">
              <VendorMark vendor={current.vendor} className="h-4" />
            </div>
          </div>
        </div>

        {current.description ? (
          <p className="text-foreground/80 text-sm leading-relaxed text-pretty">
            {current.description}
          </p>
        ) : null}

        <MetaTagChips
          llm={llm}
          hosting={hosting}
          modelLabel={labels.modelLabel}
          hostingLabel={labels.hostingLabel}
        />

        <OfferPicker
          name={current.name}
          offers={current.offers ?? []}
          labels={{
            title: labels.tasksTitle,
            startFromScratch: labels.startFromScratch,
            startFromScratchHint: labels.startFromScratchHint,
            previewExample: labels.previewExample,
          }}
          onPickOffer={onPickOffer}
          onPreviewOffer={setPreviewOffer}
          onStartFromScratch={onStartFromScratch}
        />
      </div>

      {/* Example-output preview — same rich dialog as the agents marketplace */}
      <OfferDetailDialog
        item={
          previewOffer
            ? ({
                offer: previewOffer,
                coworkerName: current.name,
                coworkerCaption: current.caption ?? undefined,
                vendor: current.vendor,
                coworkerAvatar: (
                  <Avatar className="ring-border size-11 rounded-full ring-1">
                    <AvatarImage
                      src={current.image}
                      alt=""
                      className="object-cover"
                    />
                    <AvatarFallback className="rounded-full text-sm font-medium">
                      {initials(current.name)}
                    </AvatarFallback>
                  </Avatar>
                ),
                metaTags:
                  llm.length > 0 || hosting ? (
                    <MetaTagChips
                      llm={llm}
                      hosting={hosting}
                      modelLabel={labels.modelLabel}
                      hostingLabel={labels.hostingLabel}
                    />
                  ) : undefined,
              } satisfies OfferDetailItem)
            : null
        }
        onClose={() => setPreviewOffer(null)}
        onStart={() => {
          if (previewOffer) onPickOffer(previewOffer);
          setPreviewOffer(null);
        }}
        labels={{
          deliveredBy: t("deliveredByLabel"),
          deliverable: t("deliverableLabel"),
          start: labels.previewUse,
          pending: labels.previewEmpty,
          openInNewTab: t("openInNewTab"),
          fallbackTitle: t("offerDetails"),
        }}
        typeLabel={getTypeLabel}
      />
    </div>
  );
}
