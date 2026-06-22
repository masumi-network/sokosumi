"use client";

import { useMemo } from "react";

import { CompanyMark } from "@/components/agents/company-mark";
import { TagIcon } from "@/components/agents/tag-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

/** Combined first step: a spotlight master-detail — pick a coworker on the left,
 *  see their details + large ready-to-run task cards on the right. Picking a task
 *  (or "start from scratch") advances to the editor. */
export function AgentSpotlight({
  options,
  selectedId,
  onSelect,
  onPickOffer,
  onStartFromScratch,
  defaultSlug = "elena",
  labels,
}: AgentSpotlightProps) {
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

  if (!current) {
    return (
      <p className="text-muted-foreground flex-1 py-8 text-center text-sm">
        {labels.noResults}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Rail — coworker selector, grouped by company */}
      <div
        className={cn(
          "w-52 shrink-0 space-y-4 overflow-y-auto py-1 pr-3",
          SCROLLBAR,
        )}
      >
        {groups.map((group) => (
          <div key={group.company || "_none"} className="space-y-1">
            <p className="text-muted-foreground px-2 text-xs font-medium">
              {group.company || "Other"}
            </p>
            {group.members.map((member) => {
              const active = member.id === current.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(member.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                    FOCUS_RING,
                    active ? "bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <Avatar className="ring-border size-8 shrink-0 rounded-full ring-1">
                    <AvatarImage
                      src={member.image}
                      alt=""
                      className="object-cover"
                    />
                    <AvatarFallback className="rounded-full text-xs font-medium">
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">
                      {member.name}
                    </p>
                    {member.caption ? (
                      <p className="text-muted-foreground truncate text-xs">
                        {member.caption}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Detail — spotlight + ready-to-run tasks */}
      <div
        key={current.id}
        className={cn(
          "border-border animate-in fade-in-0 min-w-0 flex-1 space-y-5 overflow-y-auto border-l py-1 pl-6",
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
          }}
          onPickOffer={onPickOffer}
          onStartFromScratch={onStartFromScratch}
        />
      </div>
    </div>
  );
}
