"use client";

import { useTranslations } from "next-intl";

import type { Coworker } from "@/app/chat/utils/types";
import { CoworkerGalleryCard } from "@/components/agents/coworker-gallery-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCoworkerMetadataChannels } from "@/lib/utils/coworker-channels";

import { ONBOARDING_FEATURE_MAX_WIDTH_CLASS } from "./feature-width";
import { chatCapableCoworkers } from "./recommend";
import type { OnboardingRecommendation } from "./types";

export interface ConfirmStepProps {
  coworkers: Coworker[];
  recommendation: OnboardingRecommendation;
  selectedCoworkerId: string;
  draftPreview: string;
  isOpening: boolean;
  errorMessage?: string;
  onSelectCoworker: (coworkerId: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}

const FOCUS_RING =
  "focus-visible:ring-primary/30 outline-none focus-visible:ring-2";
const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent [scrollbar-width:thin]";

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function CoworkerRailItem({
  coworker,
  active,
  onSelect,
  disabled,
  className,
}: {
  coworker: Coworker;
  active: boolean;
  onSelect: () => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
        FOCUS_RING,
        active ? "bg-muted" : "hover:bg-muted/50",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <Avatar className="ring-border size-8 shrink-0 rounded-full ring-1">
        <AvatarImage src={coworker.avatar} alt="" className="object-cover" />
        <AvatarFallback className="rounded-full text-xs font-medium">
          {initials(coworker.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-foreground truncate text-sm font-medium">
          {coworker.name}
        </p>
        {coworker.caption ? (
          <p className="text-muted-foreground truncate text-xs">
            {coworker.caption}
          </p>
        ) : null}
      </div>
    </button>
  );
}

/** Gallery-style card + rail switcher among coworkerCanChat (sidebar / carousel). */
export function ConfirmStep({
  coworkers,
  selectedCoworkerId,
  draftPreview,
  isOpening,
  errorMessage,
  onSelectCoworker,
  onBack,
  onConfirm,
}: ConfirmStepProps): React.ReactElement {
  const t = useTranslations("App.Chat.Onboarding");
  const switcher = chatCapableCoworkers(coworkers);
  const selected =
    switcher.find((coworker) => coworker.id === selectedCoworkerId) ??
    switcher[0] ??
    null;
  const showSwitcher = switcher.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "min-h-0 flex-1 space-y-6 overflow-y-auto pb-4",
          SCROLLBAR,
        )}
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("confirmTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("confirmDescription")}
          </p>
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-col gap-6",
            showSwitcher && "md:flex-row md:items-start md:gap-8",
          )}
        >
          {showSwitcher ? (
            <>
              {/* Mobile — horizontal strip (same pattern as task AgentSpotlight) */}
              <nav
                aria-label={t("coworkerListLabel")}
                className={cn(
                  "flex shrink-0 gap-2 overflow-x-auto border-b pb-3 md:hidden",
                  SCROLLBAR,
                )}
              >
                {switcher.map((coworker) => (
                  <CoworkerRailItem
                    key={coworker.id}
                    coworker={coworker}
                    active={coworker.id === selected?.id}
                    disabled={isOpening}
                    onSelect={() => onSelectCoworker(coworker.id)}
                    className="w-44 shrink-0"
                  />
                ))}
              </nav>

              {/* Desktop — left rail */}
              <nav
                aria-label={t("coworkerListLabel")}
                className={cn(
                  "hidden md:flex md:w-52 md:shrink-0 md:flex-col md:gap-1 md:overflow-y-auto md:py-1 md:pr-3",
                  SCROLLBAR,
                )}
              >
                {switcher.map((coworker) => (
                  <CoworkerRailItem
                    key={coworker.id}
                    coworker={coworker}
                    active={coworker.id === selected?.id}
                    disabled={isOpening}
                    onSelect={() => onSelectCoworker(coworker.id)}
                    className="w-full"
                  />
                ))}
              </nav>
            </>
          ) : null}

          <div
            className={cn(
              "flex min-w-0 flex-1 justify-center",
              showSwitcher && "md:border-border md:border-l md:pl-8",
            )}
          >
            <div
              className={cn(
                "w-full space-y-6",
                ONBOARDING_FEATURE_MAX_WIDTH_CLASS,
              )}
            >
              {selected ? (
                <CoworkerGalleryCard
                  className="w-full"
                  slug={selected.slug ?? ""}
                  name={selected.name}
                  image={selected.avatar}
                  caption={selected.caption}
                  description={selected.description}
                  channels={getCoworkerMetadataChannels({
                    metadata: selected.metadata ?? null,
                  })}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("noChatCoworker")}
                </p>
              )}

              <div className="bg-muted/50 space-y-1 rounded-lg border p-3">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t("draftPreviewLabel")}
                </p>
                <p className="text-sm whitespace-pre-wrap">{draftPreview}</p>
              </div>

              {errorMessage ? (
                <p className="text-destructive text-sm" role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Pinned to shell bottom on mobile so Open chat stays reachable */}
      <div className="border-border/60 bg-background/95 sticky bottom-0 z-10 -mx-4 mt-auto flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mx-0 md:mt-6 md:border-t-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none md:pb-0">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isOpening}
        >
          {t("back")}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onConfirm}
          disabled={isOpening || !selected}
          className={cn(isOpening && "opacity-80")}
        >
          {isOpening ? t("opening") : t("confirmCta")}
        </Button>
      </div>
    </div>
  );
}
