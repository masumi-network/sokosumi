"use client";

import { Check } from "lucide-react";

import { TagIcon } from "@/components/agents/tag-icon";
import { AssistantOrb } from "@/components/aurora-orb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { regionFlag } from "@/lib/utils/region-flag";

interface CoworkerCardLabels {
  defaultBadge: string;
  modelLabel: string;
  hostingLabel: string;
}

interface CoworkerCardProps {
  option: CoworkerOption;
  isSelected: boolean;
  isDefault?: boolean;
  onSelect: () => void;
  labels: CoworkerCardLabels;
  /** Hides the capability + model footer for a shorter card (e.g. a picker grid). */
  compact?: boolean;
}

export function CoworkerCard({
  option,
  isSelected,
  isDefault = false,
  onSelect,
  labels,
  compact = false,
}: CoworkerCardProps) {
  const capabilities = option.profile?.capabilities ?? [];
  const visibleCapabilities = capabilities.slice(0, 3);
  const extraCapabilities = capabilities.length - visibleCapabilities.length;
  const llm = option.profile?.llm ?? [];
  const hosting = option.profile?.hosting;
  const subtitle = option.caption || option.description;
  const hasMeta = llm.length > 0 || Boolean(hosting);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "group relative flex w-full flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]",
        isSelected
          ? "border-primary bg-primary/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          : "border-border bg-card hover:border-primary hover:shadow-sm",
      )}
    >
      <span
        className={cn(
          "bg-primary absolute top-4 right-4 flex size-5 items-center justify-center rounded-full transition-opacity duration-150",
          isSelected ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        <Check className="size-3 text-white" strokeWidth={3} />
      </span>

      <div className="flex items-center gap-3">
        {option.kind === "sokoBot" && !option.image && option.avatarSeed ? (
          <AssistantOrb
            seed={option.avatarSeed}
            expression="idle"
            animate={false}
            size={44}
            className="size-11 shrink-0"
            alt={option.name}
          />
        ) : (
          <Avatar className="ring-border size-11 shrink-0 rounded-xl ring-1">
            <AvatarImage
              src={option.image}
              alt={option.name}
              className="object-cover"
            />
            <AvatarFallback className="rounded-xl text-xs font-medium">
              {option.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 flex-1 pr-5">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm leading-tight font-semibold">
              {option.name}
            </p>
            {isDefault ? (
              <span className="bg-primary/10 text-primary shrink-0 rounded-md px-1.5 py-0.5 text-xs leading-none font-medium">
                {labels.defaultBadge}
              </span>
            ) : null}
          </div>
          {option.vendor ? (
            <p className="text-muted-foreground mt-1 truncate text-xs">
              by {option.vendor.name}
            </p>
          ) : null}
        </div>
      </div>

      {subtitle ? (
        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {subtitle}
        </p>
      ) : null}

      {!compact && visibleCapabilities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleCapabilities.map((capability) => (
            <span
              key={capability}
              className="bg-muted text-foreground/70 rounded-md px-2 py-1 text-xs leading-none font-medium"
            >
              {capability}
            </span>
          ))}
          {extraCapabilities > 0 ? (
            <span className="text-muted-foreground inline-flex items-center px-1 text-xs leading-none font-medium">
              +{extraCapabilities}
            </span>
          ) : null}
        </div>
      ) : null}

      {!compact && hasMeta ? (
        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-3">
          {llm.map((model) => (
            <span
              key={model}
              title={`${labels.modelLabel}: ${model}`}
              className="bg-muted/60 text-foreground/80 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs leading-none font-medium"
            >
              <TagIcon name={model} size={13} />
              {model}
            </span>
          ))}
          {hosting ? (
            <span
              title={`${labels.hostingLabel}: ${hosting}`}
              className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs leading-none font-medium"
            >
              <span aria-hidden className="text-sm leading-none">
                {regionFlag(hosting)}
              </span>
              {hosting}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
