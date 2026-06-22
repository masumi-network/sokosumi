"use client";

import { useMemo, useState } from "react";

import { CompanyMark } from "@/components/agents/company-mark";
import { OfferEmbed, offerOutputs } from "@/components/agents/offer-card";
import { TagIcon } from "@/components/agents/tag-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [previewOffer, setPreviewOffer] = useState<CoworkerOffer | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, CoworkerOption[]>();
    for (const option of options) {
      const key = option.company ?? "";
      const list = map.get(key);
      if (list) list.push(option);
      else map.set(key, [option]);
    }
    return Array.from(map.entries())
      .map(([company, members]) => ({
        company,
        members,
        topPriority: Math.max(...members.map((m) => m.priority ?? 0)),
      }))
      .sort((a, b) => {
        if (a.company === "") return 1;
        if (b.company === "") return -1;
        return (
          b.topPriority - a.topPriority || a.company.localeCompare(b.company)
        );
      });
  }, [options]);

  const current =
    options.find((option) => option.id === selectedId) ?? options[0];
  const llm = current?.profile?.llm ?? [];
  const hosting = current?.profile?.hosting;
  const previewOutput = previewOffer ? offerOutputs(previewOffer)[0] : null;

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
          <div key={group.company || "_none"} className="space-y-1">
            <p className="text-muted-foreground px-2 text-xs font-medium">
              {group.company || "Other"}
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
            {current.company ? (
              <div className="mt-1.5 flex h-5 items-center">
                <CompanyMark company={current.company} className="h-4" />
              </div>
            ) : null}
          </div>
        </div>

        {current.description ? (
          <p className="text-foreground/80 text-sm leading-relaxed text-pretty">
            {current.description}
          </p>
        ) : null}

        {llm.length > 0 || hosting ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {llm.map((model) => (
              <span
                key={model}
                title={`${labels.modelLabel}: ${model}`}
                className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
              >
                <TagIcon name={model} size={12} />
                {model}
              </span>
            ))}
            {hosting ? (
              <span
                title={`${labels.hostingLabel}: ${hosting}`}
                className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
              >
                <span aria-hidden>{regionFlag(hosting)}</span>
                {hosting}
              </span>
            ) : null}
          </div>
        ) : null}

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

      {/* Example-output preview */}
      <Dialog
        open={previewOffer !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewOffer(null);
        }}
      >
        <DialogContent className="flex h-[min(80svh,640px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogTitle className="border-b px-5 py-3 text-base font-semibold">
            {previewOffer?.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {previewOffer?.description ?? previewOffer?.title}
          </DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden">
            {previewOutput ? (
              <OfferEmbed
                output={previewOutput}
                title={previewOffer?.title ?? ""}
                pendingLabel={labels.previewEmpty}
              />
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end border-t px-5 py-3">
            <Button
              type="button"
              onClick={() => {
                if (previewOffer) onPickOffer(previewOffer);
                setPreviewOffer(null);
              }}
            >
              {labels.previewUse}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
