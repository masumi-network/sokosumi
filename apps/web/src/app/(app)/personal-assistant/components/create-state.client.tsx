"use client";

import type { SokoBotAvatar } from "@sokosumi/core-client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { CHAT_MOBILE_COMPOSER_SAFE_AREA_PB } from "@/app/chat/components/chat-mobile-tab-registry";
import { BotFace, botFaceSeed } from "@/components/soko-bot/bot-face";
import {
  SOKO_BOT_SETUP_FRAME_CLASS,
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

import { AvatarPicker } from "./avatar-picker.client";
import { openNewSokoBotRoom } from "./open-new-soko-bot-room";

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
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<SokoBotAvatar | null>(null);
  // The picker mounts loading its first set; Create waits for it, so the bot
  // does not go without the picture the set would have offered.
  const [loadingAvatars, setLoadingAvatars] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [created, setCreated] = useState<{
    name: string;
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
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingAvatars) return;
    create(avatar);
  }

  /** Create the bot with `picked`, or with no picture so it shows its orb. */
  function create(picked: SokoBotAvatar | null) {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createSokoBotAction({
        input: {
          name: trimmed,
          avatarId: picked?.id ?? null,
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
        imageUrl: picked?.imageUrl ?? null,
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
            alt={tChat("avatarAlt")}
            className="size-32"
          />
        </div>
        <h1 className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both text-foreground mt-8 text-center text-2xl font-light delay-300 duration-500 md:text-3xl text-balance wrap-break-word tracking-tight">
          {t("successTitle", { name: created.name })}
        </h1>
        <p className="animate-in fade-in fill-mode-both text-muted-foreground mt-3 text-sm delay-700 duration-500">
          {t("successHint")}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(SOKO_BOT_SETUP_FRAME_CLASS, "gap-8")}>
      <SokoBotSetupSteps current={step === "name" ? 1 : 2} />
      <form
        hidden={step !== "name"}
        onSubmit={handleContinue}
        className={step === "name" ? "flex flex-col gap-8" : "hidden"}
      >
        <header className="flex flex-col gap-2 text-center">
          <h1 className="text-foreground text-3xl font-light tracking-tight text-balance">
            {t("nameTitle")}
          </h1>
          <p className="text-muted-foreground text-sm text-pretty">
            {t("nameHint")}
          </p>
        </header>
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameId}>{t("nameLabel")}</Label>
          <Input
            ref={nameInputRef}
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder={t("namePlaceholder")}
            required
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" className="w-full">
            {t("continue")}
          </Button>
          {secondaryAction}
        </div>
      </form>
      {/* Mounted from the start, so the pictures load while the name is typed. */}
      <form
        hidden={step !== "picture"}
        onSubmit={handleSubmit}
        className={step === "picture" ? "flex flex-col gap-8" : "hidden"}
      >
        <header className="flex flex-col items-center gap-4 text-center">
          {avatar ? (
            <img
              src={avatar.imageUrl}
              alt=""
              className="size-24 rounded-full border object-cover"
            />
          ) : (
            <span className="bg-muted size-24 animate-pulse rounded-full" />
          )}
          <div className="flex flex-col gap-2">
            <h1
              ref={pictureHeadingRef}
              tabIndex={-1}
              className="text-foreground text-3xl font-light tracking-tight text-balance wrap-break-word outline-none"
            >
              {t("pictureTitle", { name: name.trim() })}
            </h1>
            <p className="text-muted-foreground text-sm text-pretty">
              {t(
                paidByOrganization ? "spendNoticeOrganization" : "spendNotice",
              )}
            </p>
          </div>
        </header>
        {/* Locked while creating: the bot gets the picture picked on submit. */}
        <fieldset disabled={isPending} className={cn(HOLDER_CLASS, "min-w-0")}>
          <div className={cn(HOLDER_ITEM_CLASS, "p-3")}>
            <AvatarPicker
              value={avatar?.id ?? null}
              onChange={setAvatar}
              onLoadingChange={setLoadingAvatars}
            />
          </div>
        </fieldset>
        {/* Pinned to the foot on phones, so Create stays in reach above the pictures. */}
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
            disabled={loadingAvatars}
            loading={isPending}
          >
            {/* Buttons do not wrap: a long name would push the phone page sideways. */}
            <span className="truncate">
              {t("submit", { name: name.trim() })}
            </span>
          </Button>
          {/* No picture: the bot shows its orb, and one can be picked later. */}
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={() => create(null)}
          >
            {t("skip")}
          </Button>
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
