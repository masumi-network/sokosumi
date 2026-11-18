"use client";

import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { CHAT_MOBILE_COMPOSER_SAFE_AREA_PB } from "@/app/chat/components/chat-mobile-tab-registry";
import { BotFace, botFaceSeed } from "@/components/soko-bot/bot-face";
import {
  SOKO_BOT_SETUP_FRAME_CLASS,
  SokoBotSetupHeader,
  SokoBotSetupSteps,
} from "@/components/soko-bot/setup-steps";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createSokoBotAction } from "@/lib/actions/soko-bot/action";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";
import { setupAssistantConnectPath } from "@/lib/workspace-gate";

import { openNewSokoBotRoom } from "./open-new-soko-bot-room";

/** Loaded when the picture step is mounted: it carries the 16 traced animals. */
const AvatarStudio = dynamic(
  () =>
    import("./avatar-studio.client").then((m) => ({ default: m.AvatarStudio })),
  { ssr: false, loading: () => <div className="bg-muted h-96 rounded-xl" /> },
);

/**
 * First visit, in steps: a name, a picture, then (on the setup page) mail and
 * calendar. Core upserts on the user, so this also reactivates an archived bot.
 */
export function CreateState({
  paidByOrganization,
  secondaryAction,
  onCreated,
}: {
  paidByOrganization: boolean;
  /** Shown under the submit button, e.g. "Later" in the first-run flow. */
  secondaryAction?: ReactNode;
  /**
   * Takes over once the bot and its room exist, instead of the reveal and
   * the jump to chat.
   */
  onCreated?: () => void;
}) {
  const t = useTranslations("App.SokoBot.Create");
  const tChat = useTranslations("App.SokoBot.Chat");
  const tStudio = useTranslations("App.SokoBot.AvatarStudio");
  const router = useRouter();
  const nameId = useId();
  const spendNoticeId = useId();
  const [name, setName] = useState("");
  // Spaces pass the native `required` check, so say what is missing here.
  const [blank, setBlank] = useState(false);
  // The studio reports its first look as it mounts, so Create waits for that.
  const [avatarCode, setAvatarCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [created, setCreated] = useState<{
    name: string;
    avatarCode: string | null;
    imageUrl: string | null;
    orbSeed: string;
  } | null>(null);
  const [step, setStep] = useState<"name" | "picture">("name");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const pictureHeadingRef = useRef<HTMLHeadingElement>(null);

  // Hide the mobile tab bar for the whole flow, as the first-run setup does:
  // it covered Create, and a tap there left the flow. A body attribute, not
  // `:has`, so a hidden Activity segment cannot keep the bar hidden.
  useMountEffect(() => {
    document.body.dataset.sokoBotCreating = "true";
    return () => {
      delete document.body.dataset.sokoBotCreating;
    };
  });

  // Each step hides the form that held focus, so move it into the new step.
  function goToStep(next: "name" | "picture") {
    flushSync(() => setStep(next));
    (next === "name" ? nameInputRef : pictureHeadingRef).current?.focus();
  }

  function handleContinue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) goToStep("picture");
    else {
      setBlank(true);
      nameInputRef.current?.focus();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !avatarCode) return;
    create(avatarCode);
  }

  /** Create the bot, then give it the look picked; Core draws it a random one meanwhile. */
  function create(code: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createSokoBotAction({
        input: {
          name: trimmed,
          // Core keeps this look, or draws a random one if another bot took it meanwhile.
          avatarCode: code,
          // Its stand-up and wraps run on this clock, not Core's Berlin default.
          timezone: getDefaultTimezone(),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      // Both paths end in the bot's room, so it says hello before either.
      await openNewSokoBotRoom(result.value.id);
      if (onCreated) {
        onCreated();
        return;
      }
      setCreated({
        name: result.value.name ?? trimmed,
        avatarCode: result.value.avatarCode ?? null,
        imageUrl: result.value.avatarImageUrl ?? null,
        orbSeed: botFaceSeed(result.value, result.value.userId),
      });
      // Let the reveal play, then the last step: mail and calendar.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      router.push(setupAssistantConnectPath(SOKO_BOT_ROUTE));
    });
  }

  if (created) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-12 md:py-20">
        <div
          className={cn(
            "animate-in zoom-in-50 fade-in fill-mode-both duration-500",
            "ease-[cubic-bezier(0.25,1,0.5,1)]",
          )}
        >
          <BotFace
            imageUrl={created.imageUrl}
            seed={created.orbSeed}
            orbSize={128}
            avatarCode={created.avatarCode}
            avatarSize={128}
            alt={tChat("avatarAlt")}
            className="size-32"
          />
        </div>
        <h1 className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both text-foreground mt-8 text-center text-2xl font-light delay-300 duration-500 md:text-3xl text-balance wrap-anywhere tracking-tight">
          {t("successTitle", { name: created.name })}
        </h1>
        <p className="animate-in fade-in fill-mode-both text-muted-foreground mt-3 text-sm delay-700 duration-500">
          {t("successHint")}
        </p>
      </div>
    );
  }

  return (
    <div className={SOKO_BOT_SETUP_FRAME_CLASS}>
      <SokoBotSetupSteps current={step === "name" ? 1 : 2} />
      <form
        hidden={step !== "name"}
        onSubmit={handleContinue}
        className={step === "name" ? "flex flex-col gap-8" : "hidden"}
      >
        <SokoBotSetupHeader title={t("nameTitle")} hint={t("nameHint")} />
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameId}>{t("nameLabel")}</Label>
          <Input
            ref={nameInputRef}
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setBlank(false);
            }}
            maxLength={80}
            placeholder={t("namePlaceholder")}
            required
            autoComplete="off"
            autoFocus
            aria-invalid={blank || undefined}
            aria-describedby={blank ? `${nameId}-error` : undefined}
          />
          {blank ? (
            <p
              id={`${nameId}-error`}
              role="alert"
              className="text-destructive text-xs"
            >
              {t("nameRequired")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" className="w-full">
            {t("continue")}
          </Button>
          {secondaryAction}
        </div>
      </form>
      {/* Mounted from the start, so the studio loads while the name is typed. */}
      <form
        hidden={step !== "picture"}
        onSubmit={handleSubmit}
        className={step === "picture" ? "flex flex-col gap-8" : "hidden"}
      >
        <SokoBotSetupHeader
          faceless
          title={t("pictureTitle", { name: name.trim() })}
          // A look costs nothing; the credit notice sits under Create, which makes the bot.
          hint={tStudio("description")}
          headingRef={pictureHeadingRef}
        />
        {/* Locked while creating: the bot gets the picture picked on submit.
            The scroll margin keeps a focused picture clear of the pinned buttons. */}
        <fieldset
          disabled={isPending}
          className={cn(HOLDER_CLASS, "min-w-0 [&_button]:scroll-mb-40")}
        >
          <div className={cn(HOLDER_ITEM_CLASS, "p-3")}>
            <AvatarStudio initialCode={null} onChange={setAvatarCode} />
          </div>
        </fieldset>
        {/* Pinned to the foot on phones, so Create stays in reach above the pictures.
            Only the create button and its short credit notice, seen whenever Create is:
            a taller bar hid the pictures it sits over. */}
        <div
          className={cn(
            "bg-background sticky bottom-0 flex flex-col gap-2 pt-3 md:static md:pt-0",
            CHAT_MOBILE_COMPOSER_SAFE_AREA_PB,
            "md:pb-0",
          )}
        >
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            // Locked while it creates, so a second submit cannot race the first.
            disabled={isPending || !avatarCode}
            loading={isPending}
            aria-describedby={spendNoticeId}
          >
            {/* Buttons do not wrap: a long name would push the phone page sideways. */}
            <span className="truncate">
              {t("submit", { name: name.trim() })}
            </span>
          </Button>
          <p
            id={spendNoticeId}
            className="text-muted-foreground text-center text-xs"
          >
            {t(paidByOrganization ? "spendNoticeOrganization" : "spendNotice")}
          </p>
        </div>
        {/* Right under the pinned button once scrolled to the end. */}
        <div className="-mt-6 flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={() => goToStep("name")}
          >
            <ArrowLeft aria-hidden />
            {t("back")}
          </Button>
        </div>
      </form>
    </div>
  );
}
