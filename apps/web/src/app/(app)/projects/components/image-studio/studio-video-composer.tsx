"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useId } from "react";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { creditsForVideo, videoModelsFor } from "./catalog";
import {
  STUDIO_COMPOSER_GUTTER_CLASS,
  STUDIO_PILL_CLASS,
} from "./studio-classes";
import {
  assetContentUrl,
  type StudioAsset,
  type StudioCatalog,
  type StudioLabels,
  type StudioVideoModel,
} from "./types";

const MAX_PROMPT_LENGTH = 4_000;

export interface StudioVideoSettings {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
}

export interface StudioVideoDraft {
  modelId: string;
  settings: StudioVideoSettings;
}

/** A model's own defaults: 9:16, five seconds, its first resolution. */
export function videoDraftFor(model: StudioVideoModel): StudioVideoDraft {
  return {
    modelId: model.id,
    settings: {
      aspectRatio: model.aspectRatios.includes("9:16")
        ? "9:16"
        : (model.aspectRatios[0] ?? ""),
      durationSeconds: model.durations.includes(5)
        ? 5
        : (model.durations[0] ?? 5),
      resolution: model.resolutions[0] ?? "",
    },
  };
}

/** Keep what still applies when the model changes; take the new model's defaults for the rest. */
export function carryVideoSettings(
  model: StudioVideoModel,
  current: StudioVideoSettings,
): StudioVideoSettings {
  const fallback = videoDraftFor(model).settings;
  return {
    aspectRatio: model.aspectRatios.includes(current.aspectRatio)
      ? current.aspectRatio
      : fallback.aspectRatio,
    durationSeconds: model.durations.includes(current.durationSeconds)
      ? current.durationSeconds
      : fallback.durationSeconds,
    resolution: model.resolutions.includes(current.resolution)
      ? current.resolution
      : fallback.resolution,
  };
}

const TRIGGER_CLASS =
  "text-muted-foreground hover:text-foreground h-8 max-w-[16rem] min-w-0 gap-1.5 px-2 text-sm font-medium";

function chipClass(active: boolean): string {
  return cn(
    STUDIO_PILL_CLASS,
    "border",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:text-foreground hover:border-primary-tertiary",
  );
}

/**
 * Where a video is described and bought: one model, one clip.
 *
 * The image composer's shape — the prompt is the surface, the model and the
 * clip's settings are two summaries that open on demand — without its batch
 * machinery, because a video costs several images and takes minutes, and one
 * at a time is the honest default.
 */
export function StudioVideoComposer({
  busy,
  canGenerate: projectReady,
  catalog,
  draft,
  labels,
  modeSwitch,
  onClearSource,
  onDraftChange,
  onGenerate,
  onPromptChange,
  prompt,
  promptRef,
  source,
}: {
  busy: boolean;
  /** False until a project is open: a video is made in one. */
  canGenerate: boolean;
  catalog: StudioCatalog;
  draft: StudioVideoDraft;
  labels: StudioLabels;
  modeSwitch: React.ReactNode;
  onClearSource: () => void;
  onDraftChange: (draft: StudioVideoDraft) => void;
  onGenerate: () => void;
  onPromptChange: (value: string) => void;
  prompt: string;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  /** The image being animated, or null for a video from the prompt. */
  source: StudioAsset | null;
}) {
  const t = useTranslations("App.Studio");
  const promptHelpId = useId();
  const models = videoModelsFor(catalog, source ? "image" : "text");
  const model =
    models.find((candidate) => candidate.id === draft.modelId) ?? models[0];
  const { settings } = draft;
  const credits = model ? creditsForVideo(model, settings) : null;
  const promptTooLong = prompt.length > MAX_PROMPT_LENGTH;
  const ready =
    projectReady &&
    !busy &&
    model !== undefined &&
    credits !== null &&
    prompt.trim().length > 0 &&
    !promptTooLong;

  function update(next: Partial<StudioVideoSettings>) {
    if (!model) return;
    onDraftChange({ modelId: model.id, settings: { ...settings, ...next } });
  }

  function submit() {
    if (ready) onGenerate();
  }

  const optionSummary = [
    model && model.aspectRatios.length > 0 ? settings.aspectRatio : null,
    `${settings.durationSeconds}s`,
    settings.resolution,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={labels.videoComposerTitle}
      className="min-w-0 shrink-0 space-y-2"
    >
      <RoomMessageComposer
        attachments={[]}
        belowEditor={
          <>
            <span className="sr-only" id={promptHelpId}>
              {t("promptShortcut")}
            </span>
            {promptTooLong ? (
              <p className="text-destructive px-4 pb-2 text-xs" role="alert">
                {t("promptTooLong", { limit: MAX_PROMPT_LENGTH })}
              </p>
            ) : null}
            {!projectReady ? (
              <p className="text-muted-foreground px-4 pb-2 text-xs">
                {labels.videoNeedsProject}
              </p>
            ) : null}
            {source ? (
              <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-2">
                <span className="text-muted-foreground text-xs font-medium">
                  {labels.animating}
                </span>
                <span className="border-border flex items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-0.5 text-xs">
                  <img
                    alt=""
                    className="size-5 rounded-sm object-cover"
                    src={assetContentUrl(source)}
                  />
                  v{source.version}
                </span>
                <Button
                  type="button"
                  className="hit-area size-6"
                  onClick={onClearSource}
                  size="icon"
                  variant="ghost"
                >
                  <X aria-hidden className="size-3.5" />
                  <span className="sr-only">{labels.stopAnimating}</span>
                </Button>
              </div>
            ) : null}
          </>
        }
        className={STUDIO_COMPOSER_GUTTER_CLASS}
        isSending={busy}
        onRemoveAttachment={() => undefined}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        removeAttachmentLabel={() => ""}
        sendAriaLabel={labels.generateVideo}
        sendDisabled={!ready}
        toolbarEnd={
          credits === null ? null : (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("creditsCount", { count: credits })}
            </span>
          )
        }
        toolbarStart={
          <>
            {modeSwitch}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className={TRIGGER_CLASS}
                  size="sm"
                  variant="ghost"
                >
                  <span className="sr-only">{labels.model}</span>
                  <span className="min-w-0 truncate">{model?.label}</span>
                  <ChevronDown
                    aria-hidden
                    className="text-muted-foreground size-3.5"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-80 max-w-[calc(100vw-2rem)] p-2"
              >
                <div aria-label={labels.model} role="radiogroup">
                  {models.map((candidate) => {
                    const checked = candidate.id === model?.id;
                    const next = carryVideoSettings(candidate, settings);
                    const price = creditsForVideo(candidate, next);
                    return (
                      <button
                        aria-checked={checked}
                        className="hover:bg-accent focus-visible:ring-ring-halo flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
                        key={candidate.id}
                        onClick={() =>
                          onDraftChange({
                            modelId: candidate.id,
                            settings: next,
                          })
                        }
                        role="radio"
                        type="button"
                      >
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                          {checked ? (
                            <Check aria-hidden className="size-4" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {candidate.label}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {candidate.description}
                          </span>
                        </span>
                        {price === null ? null : (
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {t("creditsCount", { count: price })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className={TRIGGER_CLASS}
                  size="sm"
                  variant="ghost"
                >
                  <span className="sr-only">{labels.moreOptions}</span>
                  <span className="min-w-0 truncate tabular-nums">
                    {optionSummary}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className="text-muted-foreground size-3.5"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-80 max-w-[calc(100vw-2rem)] space-y-3"
              >
                {model && model.aspectRatios.length > 0 ? (
                  <Row label={labels.aspectRatio}>
                    {model.aspectRatios.map((ratio) => (
                      <button
                        aria-pressed={settings.aspectRatio === ratio}
                        className={chipClass(settings.aspectRatio === ratio)}
                        key={ratio}
                        onClick={() => update({ aspectRatio: ratio })}
                        type="button"
                      >
                        {ratio}
                      </button>
                    ))}
                  </Row>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {labels.videoFollowsImage}
                  </p>
                )}
                <Row label={labels.videoLength}>
                  {model?.durations.map((seconds) => (
                    <button
                      aria-pressed={settings.durationSeconds === seconds}
                      className={chipClass(
                        settings.durationSeconds === seconds,
                      )}
                      key={seconds}
                      onClick={() => update({ durationSeconds: seconds })}
                      type="button"
                    >
                      {seconds}s
                    </button>
                  ))}
                </Row>
                <Row label={labels.resolution}>
                  {model?.resolutions.map((resolution) => (
                    <button
                      aria-pressed={settings.resolution === resolution}
                      className={chipClass(settings.resolution === resolution)}
                      key={resolution}
                      onClick={() => update({ resolution })}
                      type="button"
                    >
                      {resolution}
                    </button>
                  ))}
                </Row>
              </PopoverContent>
            </Popover>
          </>
        }
        withOuterPadding={false}
        withSafeAreaPadding
      >
        <Textarea
          aria-describedby={promptHelpId}
          aria-invalid={promptTooLong || undefined}
          aria-label={labels.videoPromptPlaceholder}
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.shiftKey &&
              !event.altKey &&
              !event.repeat &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={labels.videoPromptPlaceholder}
          ref={promptRef}
          value={prompt}
        />
      </RoomMessageComposer>
    </section>
  );
}

function Row({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}

/** Image or Video: which composer is docked. */
export function StudioModeSwitch({
  labels,
  mode,
  onModeChange,
}: {
  labels: StudioLabels;
  mode: "image" | "video";
  onModeChange: (mode: "image" | "video") => void;
}) {
  return (
    <div
      aria-label={labels.studioMode}
      className="flex shrink-0 items-center gap-1"
      role="radiogroup"
    >
      {(
        [
          ["image", labels.modeImage],
          ["video", labels.modeVideo],
        ] as const
      ).map(([value, label]) => (
        <button
          aria-checked={mode === value}
          className={chipClass(mode === value)}
          key={value}
          onClick={() => onModeChange(value)}
          role="radio"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
