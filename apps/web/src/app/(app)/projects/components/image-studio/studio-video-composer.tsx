"use client";

import { ChevronDown, X } from "lucide-react";
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
import { creditsForVideo } from "./catalog";
import {
  STUDIO_COMPOSER_GUTTER_CLASS,
  STUDIO_PILL_CLASS,
} from "./studio-classes";
import {
  assetContentUrl,
  type StudioAsset,
  type StudioLabels,
  type StudioVideoModel,
} from "./types";

const MAX_PROMPT_LENGTH = 4_000;

export interface StudioVideoSettings {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
}

/**
 * A model's own defaults: 9:16, five seconds, its first resolution.
 * Keep what still applies when the model changes; take the new model's defaults for the rest.
 */
export function videoSettingsFor(
  model: StudioVideoModel,
  current: StudioVideoSettings | null = null,
): StudioVideoSettings {
  const aspectRatio = current?.aspectRatio ?? "9:16";
  const durationSeconds = current?.durationSeconds ?? 5;
  return {
    aspectRatio: model.aspectRatios.includes(aspectRatio)
      ? aspectRatio
      : model.aspectRatios.includes("9:16")
        ? "9:16"
        : (model.aspectRatios[0] ?? ""),
    durationSeconds: model.durations.includes(durationSeconds)
      ? durationSeconds
      : model.durations.includes(5)
        ? 5
        : (model.durations[0] ?? 5),
    resolution:
      current && model.resolutions.includes(current.resolution)
        ? current.resolution
        : (model.resolutions[0] ?? ""),
  };
}

const TRIGGER_CLASS =
  "text-muted-foreground hover:text-foreground h-8 max-w-[min(16rem,100%)] min-w-0 gap-1.5 px-2 text-sm font-medium";

function chipClass(active: boolean): string {
  return cn(
    STUDIO_PILL_CLASS,
    "border",
    active
      ? "border-foreground bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
  );
}

/**
 * Where a video is described and bought: one model, one clip.
 *
 * The prompt, adjustable clip settings and price all refer to the same
 * automatically selected model.
 */
export function StudioVideoComposer({
  busy,
  canGenerate: projectReady,
  model,
  settings,
  labels,
  modeSwitch,
  onClearSource,
  onSettingsChange,
  onGenerate,
  onPromptChange,
  prompt,
  promptRef,
  source,
}: {
  busy: boolean;
  /** False until a project is open: a video is made in one. */
  canGenerate: boolean;
  model: StudioVideoModel;
  settings: StudioVideoSettings;
  labels: StudioLabels;
  modeSwitch: React.ReactNode;
  onClearSource: () => void;
  onSettingsChange: (settings: StudioVideoSettings) => void;
  onGenerate: () => void;
  onPromptChange: (value: string) => void;
  prompt: string;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  /** The image being animated, or null for a video from the prompt. */
  source: StudioAsset | null;
}) {
  const t = useTranslations("App.Studio");
  const promptHelpId = useId();
  const credits = creditsForVideo(model, settings);
  const promptTooLong = prompt.length > MAX_PROMPT_LENGTH;
  const ready =
    projectReady &&
    !busy &&
    credits !== null &&
    prompt.trim().length > 0 &&
    !promptTooLong;

  function update(next: Partial<StudioVideoSettings>) {
    onSettingsChange({ ...settings, ...next });
  }

  function submit() {
    if (ready) onGenerate();
  }

  const optionSummary = [
    model.aspectRatios.length > 0 ? settings.aspectRatio : null,
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
        toolbarStart={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {modeSwitch}
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
                {model.aspectRatios.length > 0 ? (
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
                  {model.durations.map((seconds) => (
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
                  {model.resolutions.map((resolution) => (
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
            {credits === null ? null : (
              <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                {t("creditsCount", { count: credits })}
              </span>
            )}
          </div>
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

/**
 * The phone's main mode switch keeps its 28px pill but takes a 44px tap target
 * below `md`: a transparent `::after` centred like `hit-area`, which stops at
 * 40px. The composer toolbar scrolls sideways, so it clips anything outside
 * its rows; the group's `py-2` makes its row tall enough to hold the target.
 * Desktop is untouched.
 */
const MODE_TAP_TARGET_CLASS =
  "relative max-md:after:absolute max-md:after:inset-[min(0px,calc((100%_-_var(--spacing)*11)_/_2))]";

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
      className="flex shrink-0 items-center gap-1 max-md:py-2"
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
          className={cn(chipClass(mode === value), MODE_TAP_TARGET_CLASS)}
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
