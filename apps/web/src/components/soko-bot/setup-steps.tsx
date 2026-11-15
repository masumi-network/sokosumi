"use client";

import { useTranslations } from "next-intl";
import type { Ref } from "react";
import { BotFace } from "@/components/soko-bot/bot-face";
import { cn } from "@/lib/utils";

/**
 * One frame for every setup step. Setup pages centre their content, so the
 * frame sits at the top instead: a taller step (the pictures) would otherwise
 * move the progress bar from one step to the next.
 */
export const SOKO_BOT_SETUP_FRAME_CLASS =
  "mx-auto flex w-full max-w-md flex-col gap-8 self-start px-4 py-12 md:py-20";

const STEPS = ["stepName", "stepPicture", "stepConnect"] as const;

/** Where a new Soko Bot's setup stands: name, picture, then connect. */
export function SokoBotSetupSteps({ current }: { current: 1 | 2 | 3 }) {
  const t = useTranslations("App.SokoBot.Create");
  return (
    <ol
      aria-label={t("stepOf", { current, total: STEPS.length })}
      className="flex w-full items-center gap-2"
    >
      {STEPS.map((key, index) => {
        const step = index + 1;
        return (
          <li
            key={key}
            aria-current={step === current ? "step" : undefined}
            className="flex flex-1 flex-col gap-2"
          >
            <span
              className={cn(
                "h-1 rounded-full transition-colors duration-200",
                step <= current ? "bg-primary" : "bg-muted",
              )}
            />
            <span
              className={cn(
                "text-xs",
                step === current
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The top of every setup step: the bot's face in one place (an empty disc
 * until a picture is picked), then the step's heading and hint.
 */
export function SokoBotSetupHeader({
  imageUrl = null,
  seed,
  loading = false,
  title,
  hint,
  headingRef,
}: {
  imageUrl?: string | null;
  /** Draws the bot's orb when it has no picture; omit for the empty disc. */
  seed?: string;
  /** Pulses the empty disc while pictures load. */
  loading?: boolean;
  title: string;
  hint: string;
  /** Steps that start at their heading focus it through this. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      {imageUrl || seed ? (
        <BotFace
          imageUrl={imageUrl}
          seed={seed ?? ""}
          orbSize={192}
          className={cn("size-24 rounded-full", imageUrl && "border")}
        />
      ) : (
        <span
          className={cn(
            "bg-muted size-24 rounded-full",
            loading && "animate-pulse",
          )}
        />
      )}
      <div className="flex flex-col gap-2">
        <h1
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="text-foreground text-3xl font-light tracking-tight text-balance wrap-anywhere outline-none"
        >
          {title}
        </h1>
        <p className="text-muted-foreground text-sm text-pretty">{hint}</p>
      </div>
    </header>
  );
}
