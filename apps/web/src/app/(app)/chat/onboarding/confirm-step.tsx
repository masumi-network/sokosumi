"use client";

import { useTranslations } from "next-intl";

import type { Coworker } from "@/app/chat/utils/types";
import { CoworkerGalleryCard } from "@/components/agents/coworker-gallery-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getCoworkerMetadataChannels } from "@/lib/utils/coworker-channels";

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

/** Gallery-style card + switcher among coworkerCanChat. */
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("confirmTitle")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("confirmDescription")}
        </p>
      </div>

      {selected ? (
        <div className="flex justify-center">
          <CoworkerGalleryCard
            className="w-full max-w-sm"
            slug={selected.slug ?? ""}
            name={selected.name}
            image={selected.avatar}
            caption={selected.caption}
            description={selected.description}
            channels={getCoworkerMetadataChannels({
              metadata: selected.metadata ?? null,
            })}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noChatCoworker")}</p>
      )}

      {switcher.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="onboarding-coworker-switch">
            {t("switchCoworker")}
          </Label>
          <Select
            value={selected?.id}
            onValueChange={onSelectCoworker}
            disabled={isOpening}
          >
            <SelectTrigger id="onboarding-coworker-switch" className="w-full">
              <SelectValue placeholder={t("switchCoworker")} />
            </SelectTrigger>
            <SelectContent>
              {switcher.map((coworker) => (
                <SelectItem key={coworker.id} value={coworker.id}>
                  {coworker.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

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

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
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
