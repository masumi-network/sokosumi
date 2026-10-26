"use client";

import type { SokoBotAvatar } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSokoBotAction } from "@/lib/actions/soko-bot/action";
import { cn } from "@/lib/utils";

import { AvatarPicker } from "./avatar-picker.client";
import { openNewSokoBotRoom } from "./open-new-soko-bot-room";

/**
 * First visit: the bot's orb, what it does, a name, and a picture.
 * Core upserts on the user, so this also reactivates an archived bot.
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
  const [isPending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ name: string } | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createSokoBotAction({
        input: { name: trimmed, avatarId: avatar?.id ?? null },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      if (onCreated) {
        await openNewSokoBotRoom(result.value.id);
        onCreated();
        return;
      }
      setCreated({ name: result.value.name ?? trimmed });
      // Let the reveal play before the chat takes over.
      const reveal = new Promise((resolve) => setTimeout(resolve, 1800));
      const roomId = await openNewSokoBotRoom(result.value.id);
      await reveal;
      if (roomId) {
        router.push(`/chat/rooms/${encodeURIComponent(roomId)}`);
        return;
      }
      router.refresh();
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
          {avatar ? (
            <img
              src={avatar.imageUrl}
              alt={tChat("avatarAlt")}
              className="ring-ring-halo size-32 rounded-full object-cover ring-4"
            />
          ) : null}
        </div>
        <h1 className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both text-foreground mt-8 text-center text-2xl font-light delay-300 duration-500 md:text-3xl text-balance tracking-tight">
          {t("successTitle", { name: created.name })}
        </h1>
        <p className="animate-in fade-in fill-mode-both text-muted-foreground mt-3 text-sm delay-700 duration-500">
          {t("successHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-12 md:py-20">
      <h1 className="text-foreground text-center text-2xl font-light text-balance md:text-3xl tracking-tight">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md text-center text-sm leading-relaxed text-pretty md:text-base">
        {t("description")}
      </p>

      {/* People meet the idea here for the first time: say what it does in
          their terms before asking them to name one. */}
      <ul
        aria-label={t("examplesLabel")}
        className="mt-8 w-full space-y-3 text-sm leading-relaxed"
      >
        {(["exampleDelegate", "exampleBrief", "exampleMemory"] as const).map(
          (key) => (
            <li key={key} className="flex gap-3">
              <Check
                aria-hidden
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
              />
              <span className="text-foreground text-pretty">{t(key)}</span>
            </li>
          ),
        )}
      </ul>

      <form onSubmit={handleSubmit} className="mt-10 w-full space-y-6">
        <p className="text-foreground text-sm font-medium">{t("nameIntro")}</p>
        <div className="space-y-2">
          <Label htmlFor={nameId}>{t("nameLabel")}</Label>
          <Input
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

        <div className="space-y-2">
          <Label>{t("avatarLabel")}</Label>
          <AvatarPicker value={avatar?.id ?? null} onChange={setAvatar} />
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
          {t(paidByOrganization ? "spendNoticeOrganization" : "spendNotice")}
        </p>

        <Button
          type="submit"
          className="w-full"
          loading={isPending}
          disabled={name.trim().length === 0}
        >
          {t("submit")}
        </Button>
        {secondaryAction}
      </form>
    </div>
  );
}
